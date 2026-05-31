"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

type Option = { id: string; kind: string; label: string; startsAt?: string; place?: string; priceTier?: number };
type VoteTally = { optionId: string; up: number; down: number };
type Plan = { id: string; title: string; state: string; options: Option[]; votes: VoteTally[]; lockedOptionId?: string; viewerRsvp?: string };
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
  const [rsvp, setRsvp] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/public/tokens/${token}?s=${encodeURIComponent(sig)}`);
      if (!res.ok) throw new Error((await res.json()).message ?? "link invalid");
      const next = await res.json();
      setData(next);
      setRsvp(next.plan.viewerRsvp ?? "");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [token, sig]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitVote() {
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

  async function submitRsvp(status: "YES" | "MAYBE" | "NO") {
    const res = await fetch(`${API}/public/tokens/${token}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ s: sig, status }),
    });
    if (res.ok) {
      setRsvp(status);
      setSubmitted(true);
      load();
    } else {
      setErr((await res.json()).message ?? "could not record RSVP");
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

  const { plan, contactName, purpose } = data;
  const tallyOf = (id: string) => plan.votes.find((v) => v.optionId === id);
  const locked = plan.state === "LOCKED" || plan.state === "BOOKED";
  const isRsvp = purpose === "rsvp";
  const canVote = plan.state === "VOTING";

  return (
    <div className="wrap">
      <div className="eyebrow"><span className="mark">✦</span> Plot · for {contactName}</div>
      <h1 className="title">{plan.title}</h1>
      <p className="sub">
        {isRsvp
          ? "The plan is locked in. Let the group know whether you can make it."
          : locked ? "This plan is locked in."
            : canVote ? "The crew is deciding. Tap your pick, then submit — no app needed."
              : "The crew is shaping the options. This link will be ready as soon as voting opens."}
      </p>

      {!isRsvp && plan.options.map((o) => {
        const t = tallyOf(o.id);
        const isLeader = plan.lockedOptionId === o.id;
        return (
          <div
            key={o.id}
            className={`card option ${picked === o.id ? "picked" : ""} ${isLeader ? "locked" : ""}`}
            onClick={() => canVote && setPicked(o.id)}
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

      {!isRsvp && canVote && (
        <button className="btn" disabled={!picked || submitted} onClick={submitVote}>
          {submitted ? "Vote recorded ✓" : "Submit my vote"}
        </button>
      )}
      {isRsvp && (
        <div className="rsvp-grid">
          <button className={`btn ${rsvp === "YES" ? "selected" : "secondary"}`} onClick={() => submitRsvp("YES")}>I&apos;m in</button>
          <button className={`btn ${rsvp === "MAYBE" ? "selected" : "secondary"}`} onClick={() => submitRsvp("MAYBE")}>Maybe</button>
          <button className={`btn ${rsvp === "NO" ? "selected" : "secondary"}`} onClick={() => submitRsvp("NO")}>Can&apos;t make it</button>
        </div>
      )}
      {submitted && <p className="foot">Thanks — your {isRsvp ? "RSVP" : "vote"} was sent back to the group in real time.</p>}
      <p className="foot">Powered by Plot · you&apos;re responding as a guest over a secure link</p>
    </div>
  );
}
