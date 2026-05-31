"""Thin client for the NestJS internal API. Every call carries the internal-trust header so the
agent can act as Plot. The API writes the audit row for each action (audit-AFTER lives there)."""
from __future__ import annotations
import httpx
from . import config


class ApiClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or config.API_BASE_URL
        self._headers = {
            "x-plot-internal": config.INTERNAL_SECRET,
            "x-plot-actor": "plot",
            "content-type": "application/json",
        }

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base_url, headers=self._headers, timeout=30.0)

    # ── reads ──
    def context(self, thread_id: str) -> dict:
        with self._client() as c:
            return c.get(f"/internal/threads/{thread_id}/context").raise_for_status().json()

    def get_plan(self, plan_id: str) -> dict:
        with self._client() as c:
            return c.get(f"/plans/{plan_id}").raise_for_status().json()

    # ── actions (each audited API-side) ──
    def post_agent_message(
        self, thread_id: str, body: str, kind: str = "AGENT",
        plan_id: str | None = None, metadata: dict | None = None,
    ) -> dict:
        with self._client() as c:
            return c.post(
                f"/internal/threads/{thread_id}/agent-message",
                json={"body": body, "kind": kind, "planId": plan_id, "metadata": metadata},
            ).raise_for_status().json()

    def gather_availability(self, group_id: str, from_iso: str, to_iso: str, plan_id: str | None = None) -> dict:
        with self._client() as c:
            return c.post(
                "/internal/integrations/availability",
                json={"groupId": group_id, "fromIso": from_iso, "toIso": to_iso, "planId": plan_id},
            ).raise_for_status().json()

    def research_places(self, user_id: str, group_id: str, query: str, near: str | None = None) -> list[dict]:
        with self._client() as c:
            return c.post(
                "/internal/integrations/places",
                json={"userId": user_id, "groupId": group_id, "query": query, "near": near},
            ).raise_for_status().json()

    def propose(self, payload: dict) -> dict:
        with self._client() as c:
            return c.post("/internal/plans/propose", json=payload).raise_for_status().json()

    def invite_non_user(self, plan_id: str, contact_id: str, purpose: str = "vote") -> dict:
        with self._client() as c:
            return c.post(
                "/internal/non-user-invites",
                json={"planId": plan_id, "contactId": contact_id, "purpose": purpose},
            ).raise_for_status().json()

    def check_spend(self, plan_id: str, amount_cents: int) -> dict:
        with self._client() as c:
            return c.post(
                f"/internal/plans/{plan_id}/check-spend", json={"amountCents": amount_cents}
            ).raise_for_status().json()

    def lock(self, plan_id: str, reason: str = "soft-deadline") -> dict:
        with self._client() as c:
            return c.post(f"/internal/plans/{plan_id}/lock", json={"reason": reason}).raise_for_status().json()

    def create_split(self, plan_id: str, per_head_cents: int, memo: str | None = None) -> dict:
        with self._client() as c:
            return c.post(
                f"/internal/plans/{plan_id}/split",
                json={"perHeadCents": per_head_cents, "memo": memo},
            ).raise_for_status().json()

    def remember_constraint(
        self, group_id: str, text: str, kind: str,
        user_id: str | None = None, contact_id: str | None = None, expires_at: str | None = None,
    ) -> dict:
        with self._client() as c:
            return c.post(
                f"/internal/groups/{group_id}/constraints",
                json={"userId": user_id, "contactId": contact_id, "text": text, "kind": kind, "expiresAt": expires_at},
            ).raise_for_status().json()
