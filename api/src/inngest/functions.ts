import { Inngest } from "inngest";
import axios from "axios";
import { config } from "../common/config";

// Durable function: when voting opens, sleep until the soft deadline, then CALL THE AGENT to
// decide act-vs-ask (auto-lock the leader, or pause for approval if over cap / irreversible).
// The workflow OWNS the timer; the agent owns the decision (PRD §9). Survives restarts via Inngest.
export function buildFunctions(client: Inngest) {
  const softDeadlineAutoLock = client.createFunction(
    { id: "soft-deadline-auto-lock" },
    { event: "plot/voting.opened" },
    async ({ event, step }) => {
      const { planId, threadId, softDeadlineIso } = event.data as {
        planId: string;
        threadId: string;
        softDeadlineIso: string;
      };

      // Durable timer — the server-side soft deadline.
      await step.sleepUntil("await-soft-deadline", new Date(softDeadlineIso));

      // Re-enter the agent at the act-or-ask node. The agent re-checks votes/permissions/cap and
      // either locks the leader (writing an audit row + undo) or posts an approval request.
      await step.run("agent-act-or-ask", async () => {
        await axios.post(
          `${config.agentBaseUrl}/run`,
          { threadId, planId, trigger: "deadline" },
          { timeout: 30_000 },
        );
        return { calledAgent: true };
      });

      return { planId, locked: "delegated-to-agent" };
    },
  );

  return [softDeadlineAutoLock];
}
