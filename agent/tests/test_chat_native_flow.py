from plot_agent.nodes import AgentNodes


class CaptureApi:
    def __init__(self):
        self.messages = []

    def post_agent_message(self, thread_id, body, kind="AGENT", plan_id=None, metadata=None):
        self.messages.append(
            {
                "thread_id": thread_id,
                "body": body,
                "kind": kind,
                "plan_id": plan_id,
                "metadata": metadata,
            }
        )
        return self.messages[-1]

    def __getattr__(self, _name):
        return lambda **_kwargs: {}


def state(trigger="message", body="Dinner on Friday?", decision="ACT"):
    return {
        "thread_id": "thread-1",
        "trigger": trigger,
        "intent": {
            "decision": decision,
            "activity": "Friday dinner",
            "time_hint": "Friday",
            "confidence": 0.9,
        },
        "context": {"recent_messages": [{"kind": "HUMAN", "body": body}]},
    }


def test_planning_intent_routes_to_a_soft_suggestion():
    nodes = AgentNodes(api=CaptureApi())
    assert nodes.route_after_remember(state()) == "suggest"


def test_confirmed_suggestion_bypasses_the_soft_opt_in():
    nodes = AgentNodes(api=CaptureApi())
    assert nodes.route_after_remember(state(trigger="confirmed_intent")) == "loop"


def test_explicit_plot_command_can_draft_directly():
    nodes = AgentNodes(api=CaptureApi())
    assert nodes.route_after_remember(state(body="Plot, sort this for Friday dinner")) == "loop"


def test_suggestion_is_a_normal_agent_message_with_metadata():
    api = CaptureApi()
    nodes = AgentNodes(api=api)

    nodes.suggest_plan(state())

    assert api.messages[0]["kind"] == "AGENT"
    assert api.messages[0]["metadata"]["kind"] == "plot_suggestion"
    assert api.messages[0]["metadata"]["actions"] == ["draft_options", "dismiss"]
