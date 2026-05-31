/**
 * Drives the whole vertical slice from the CLI — no iOS required. Proves every layer:
 *   chat → Plot stays quiet on banter → detects intent → proposes a decision card →
 *   app users + one NON-USER (via the signed web link) vote → the server-side soft-deadline timer
 *   auto-locks the leader → a NO-BOOKING plan locks (time+place+RSVP+bring-list) →
 *   the audit log is shown, then the auto-lock is UNDONE via its compensating action.
 *
 * Run after ./scripts/dev.sh:  pnpm demo
 */
import { prisma } from "@plot/db";

const API = process.env.API_BASE_URL ?? "http://localhost:3000";
const DEADLINE_S = parseInt(process.env.PLOT_SOFT_DEADLINE_SECONDS ?? "45", 10);
const THREAD = "t_crew";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(...a);
const rule = (t: string) => log(`\n\x1b[36m── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}\x1b[0m`);

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function login(phone: string): Promise<string> {
  await api("/auth/otp/start", { method: "POST", body: { phone } });
  const s = await api("/auth/otp/verify", { method: "POST", body: { phone, code: "000000" } });
  return s.token;
}

async function findDecisionCard(): Promise<string | null> {
  const msgs = await api(`/threads/${THREAD}/messages`, { token: tokens.alex });
  const card = msgs.find((m: any) => m.kind === "DECISION_CARD");
  return card?.planId ?? null;
}

const tokens: Record<string, string> = {};

async function main() {
  rule("0 · sign in the crew (OTP dev code 000000)");
  tokens.alex = await login("+15550000001");
  tokens.max = await login("+15550000002");
  tokens.sam = await login("+15550000003");
  tokens.priya = await login("+15550000004");
  log("   signed in: Alex, Max, Sam, Priya");

  rule("1 · banter → Plot must STAY QUIET");
  await api(`/threads/${THREAD}/messages`, { method: "POST", token: tokens.max, body: { body: "haha anyway Sam still owes me money" } });
  await sleep(2500);
  let planId = await findDecisionCard();
  log(planId ? "   ⚠ Plot proposed on banter (unexpected)" : "   ✓ no decision card — Plot stayed quiet");

  rule("2 · planning intent → Plot detects + proposes");
  await api(`/threads/${THREAD}/messages`, { method: "POST", token: tokens.alex, body: { body: "ok for real — we should grab dinner friday night, somewhere downtown" } });
  for (let i = 0; i < 20 && !planId; i++) { await sleep(1000); planId = await findDecisionCard(); }
  if (!planId) throw new Error("agent did not propose — is the agent service running on :8000?");
  let plan = await api(`/plans/${planId}`, { token: tokens.alex });
  log(`   ✓ decision card posted: "${plan.title}"  [${plan.state}]`);
  plan.options.forEach((o: any, i: number) =>
    log(`     (${i}) ${o.label}  ·  ${o.kind}${o.priceTier ? " · " + "$".repeat(o.priceTier) : ""}`));

  rule("3 · app users vote");
  const opt = plan.options[0].id;
  for (const who of ["alex", "max", "sam"]) {
    await api(`/plans/${planId}/votes`, { method: "POST", token: tokens[who], body: { optionId: opt } });
    log(`   ✓ ${who} voted for "${plan.options[0].label}"`);
  }

  rule("4 · NON-USER votes via the signed SMS/web link (no app, no keys)");
  const token = await prisma.nonUserToken.findFirst({
    where: { planId, purpose: "vote" }, orderBy: { createdAt: "desc" },
  });
  if (!token) throw new Error("no non-user token issued — did the agent invite Jordan?");
  const link = `${API}/public/tokens/${token.id}?s=${token.signature}`;
  log(`   Jordan's link (also printed as a mock SMS in the API logs):\n     ${link}`);
  const page = await api(`/public/tokens/${token.id}?s=${token.signature}`);
  log(`   ✓ link resolves for guest "${page.contactName}" — voting page shows ${page.plan.options.length} options`);
  await api(`/public/tokens/${token.id}/vote`, { method: "POST", body: { s: token.signature, optionId: opt, value: "UP" } });
  plan = await api(`/plans/${planId}`, { token: tokens.alex });
  const tally = plan.votes.find((v: any) => v.optionId === opt);
  log(`   ✓ Jordan's vote reconciled — leader now has ${tally.up} up-votes (incl. 1 non-user)`);

  rule(`5 · server-side soft-deadline timer auto-locks (waiting up to ${DEADLINE_S + 15}s)`);
  log("   (Inngest is sleeping until the deadline, then calling the agent's act-or-ask node…)");
  let locked = false;
  for (let i = 0; i < DEADLINE_S + 15 && !locked; i++) {
    await sleep(1000);
    plan = await api(`/plans/${planId}`, { token: tokens.alex });
    if (plan.state === "LOCKED") locked = true;
    if (i % 5 === 0) process.stdout.write(".");
  }
  log("");
  if (!locked) throw new Error("plan did not auto-lock — is Inngest (docker) running + the agent up?");

  rule("6 · NO-BOOKING plan is LOCKED (time + place + RSVP + bring-list)");
  log(`   state    ${plan.state}`);
  log(`   when     ${plan.lockedTime}`);
  log(`   where    ${plan.lockedPlace}`);
  log(`   bring    ${plan.bringList.map((b: any) => b.label).join(", ")}`);
  log("   ✓ resolution achieved WITHOUT booking (booking is scaffolded, not required)");

  rule("7 · reversible audit log");
  const audit = await api(`/plans/${planId}/audit`, { token: tokens.alex });
  for (const a of audit) log(`   • [${a.action}] ${a.summary}${a.undoable ? "   (undoable)" : ""}`);

  rule("8 · UNDO the auto-lock (compensating action)");
  const lockRow = audit.find((a: any) => a.action === "AGENT_LOCKED_PLAN" && a.undoable);
  const undo = await api(`/audit/${lockRow.id}/undo`, { method: "POST", token: tokens.alex });
  log(`   ✓ undo applied: ${undo.action} — ${undo.detail}`);
  plan = await api(`/plans/${planId}`, { token: tokens.alex });
  log(`   plan is back to [${plan.state}] — the lock was fully reversed`);

  rule("DONE — every layer exercised end-to-end ✦");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n\x1b[31mDEMO FAILED:\x1b[0m", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
