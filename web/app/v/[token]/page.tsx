"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

type Option = { id: string; kind: string; label: string; startsAt?: string; place?: string; priceTier?: number };
type VoteTally = { optionId: string; up: number; down: number };
type Plan = { id: string; title: string; state: string; options: Option[]; votes: VoteTally[]; lockedOptionId?: string };
type PageData = { purpose: string; contactName: string; plan: Plan };

function fmtTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
const tier = (n?: number) => (n ? "$".repeat(n) : "");

export default function VotePage() {
  const params = useParams<{ token: string }>();
  const sig = useSearchParams().get("s") ?? "";
  const token = params.token;

  const [data, setData] = useState<PageData | null>(null);
  const [err, setErr] = useState<string>("");
  const [picked, setPicked] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/public/tokens/${token}?s=${encodeURIComponent(sig)}`);
      if (!res.ok) throw new Error((await res.json()).message ?? "link invalid");
      setData(await res.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [token, sig]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!picked) return;
    const res = await fetch(`${API}/public/tokens/${token}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ s: sig, optionId: picked, value: "UP" }),
    });
    if (res.ok) {
      setSubmitted(true);
      setData((d) => (d ? { ...d, plan: { ...d.plan } } : d));
      load();
    } else {
      setErr((await res.json()).message ?? "could not record vote");
    }
  }

  if (err) {
    return (
      <div className="wrap">
        <div className="eyebrow"><span className="mark">✦</span> Plot</div>
        <h1 className="title">This link isn’t valid</h1>
        <p className="sub err">{err}</p>
      </div>
    );
  }
  if (!data) return <div className="wrap"><p className="sub">Loading…</p></div>;

  const { plan, contactName } = data;
  const tallyOf = (id: string) => plan.votes.find((v) => v.optionId === id);
  const locked = plan.state === "LOCKED" || plan.state === "BOOKED";

  return (
    <div className="wrap">
      <div className="eyebrow"><span className="mark">✦</span> Plot · for {contactName}</div>
      <h1 className="title">{plan.title}</h1>
      <p className="sub">
        {locked ? "This plan is locked in." : "The crew is deciding. Tap your pick, then submit — no app needed."}
      </p>

      {plan.options.map((o) => {
        const t = tallyOf(o.id);
        const isLeader = plan.lockedOptionId === o.id;
        return (
          <div
            key={o.id}
            className={`card option ${picked === o.id ? "picked" : ""} ${isLeader ? "locked" : ""}`}
            onClick={() => !locked && setPicked(o.id)}
          >
            <div>
              <div className="label">{o.label} {isLeader ? "✓" : ""}</div>
              <div className="meta">
                {o.kind}{o.startsAt ? ` · ${fmtTime(o.startsAt)}` : ""}{o.priceTier ? ` · ${tier(o.priceTier)}` : ""}
              </div>
            </div>
            <div className="tally">▲ {t?.up ?? 0}</div>
          </div>
        );
      })}

      {!locked && (
        <button className="btn" disabled={!picked || submitted} onClick={submit}>
          {submitted ? "Vote recorded ✓" : "Submit my vote"}
        </button>
      )}
      {submitted && <p className="foot">Thanks — your vote was sent back to the group in real time.</p>}
      <p className="foot">Powered by Plot · you’re voting as a guest over a secure link</p>
    </div>
  );
}
