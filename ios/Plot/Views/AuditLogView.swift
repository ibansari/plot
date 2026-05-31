import SwiftUI

/// "Plot's Desk" — the plan running quietly under the chat: live status, self-enforcing
/// contingencies, and a reversible activity log. Mirrors the mockup's desk sheet. Every autonomous
/// action shows an Undo that applies the server-side compensating action.
struct PlotDeskView: View {
    let planId: String
    @Bindable var vm: ChatViewModel
    @Environment(\.dismiss) private var dismiss

    private var entries: [AuditEntry] { vm.audits[planId] ?? [] }
    private var plan: Plan? { vm.plans[planId] }

    var body: some View {
        ZStack {
            Theme.bg2.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    Text("The plan running quietly under the chat. Live state, contingencies, and a log of everything Plot did — each item reversible.")
                        .font(Theme.body(12.5)).foregroundStyle(Theme.textDim)
                        .padding(.bottom, 16)

                    deskStats
                    contingencies
                    SectionLabel("Activity log · everything's reversible").padding(.top, 18).padding(.bottom, 6)
                    activityLog
                    overCap
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 18).padding(.top, 8)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 11) {
            PlotMark(.m)
            Text("Plot's Desk").font(Theme.display(20)).foregroundStyle(Theme.text)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
                    .frame(width: 32, height: 32).background(Theme.surface2).clipShape(Circle())
            }
        }
        .padding(.vertical, 10)
    }

    private var deskStats: some View {
        HStack(spacing: 8) {
            stat("Status", plan?.state.rawValue.capitalized ?? "—", accent: true)
            stat("To book", "0")
            stat("Spent", "$\((plan?.spentCents ?? 0) / 100)")
        }
    }
    private func stat(_ k: String, _ v: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(k.uppercased()).font(Theme.mono(9)).tracking(0.6).foregroundStyle(Theme.textFaint)
            Text(v).font(Theme.display(18)).foregroundStyle(accent ? Theme.accent : Theme.text)
        }
        .frame(maxWidth: .infinity).padding(12)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder private var contingencies: some View {
        let list = plan?.contingencies ?? []
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel("Self-enforcing contingencies").padding(.top, 16).padding(.bottom, 2)
                VStack(alignment: .leading, spacing: 10) {
                    Text("⚙ IF SOMETHING CHANGES, PLOT WILL…").font(Theme.mono(10)).tracking(0.6).foregroundStyle(Theme.accent)
                    ForEach(Array(list.enumerated()), id: \.offset) { i, c in
                        HStack(alignment: .top, spacing: 8) {
                            Text("→").font(Theme.body(13, .bold)).foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("If \(c.ifText) → \(c.thenText).").font(Theme.body(13)).foregroundStyle(Theme.textDim)
                                if c.type == "switch_backup", let pid = plan?.id {
                                    Button("Enact now") { Task { await vm.enact(planId: pid, index: i) } }
                                        .font(Theme.mono(11)).foregroundStyle(Theme.warn)
                                }
                            }
                        }
                    }
                }
                .padding(14)
                .background(Theme.accentDim)
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.accentDim2, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private var activityLog: some View {
        VStack(spacing: 0) {
            ForEach(entries) { e in
                HStack(alignment: .top, spacing: 11) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9).fill(Theme.accentDim)
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.accentDim2, lineWidth: 1))
                        Image(systemName: icon(e.action)).font(.system(size: 13)).foregroundStyle(Theme.accent)
                    }.frame(width: 30, height: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.summary).font(Theme.body(13, .semibold)).foregroundStyle(Theme.text)
                        Text("\(e.actor) · \(relative(e.createdAt))\(e.amountCents > 0 ? " · $\(e.amountCents/100)" : "")")
                            .font(Theme.mono(10.5)).foregroundStyle(Theme.textFaint)
                    }
                    Spacer(minLength: 0)
                    if e.undoneAt != nil {
                        Text("undone").font(Theme.mono(11)).foregroundStyle(Theme.textFaint)
                    } else if e.undoable {
                        Button("Undo") { Task { await vm.undo(planId: planId, auditId: e.id) } }
                            .font(Theme.body(11.5, .bold)).foregroundStyle(Theme.accent)
                    } else {
                        Text("✓").font(Theme.mono(11)).foregroundStyle(Theme.textFaint)
                    }
                }
                .padding(.vertical, 12)
                .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
            }
            if entries.isEmpty {
                Text("No actions yet.").font(Theme.body(13)).foregroundStyle(Theme.textDim)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 14)
            }
        }
    }

    @ViewBuilder private var overCap: some View {
        // Shown only when Plot is paused waiting for spend approval (over the cap).
        if let p = plan, p.spentCents > p.spendCapCents {
            VStack(alignment: .leading, spacing: 8) {
                Text("✋ WAITING ON YOU").font(Theme.mono(10)).tracking(0.6).foregroundStyle(Theme.warn)
                HStack(alignment: .top, spacing: 8) {
                    Text("→").foregroundStyle(Theme.warn)
                    Text("An action would exceed the group's spend cap. Approve to proceed.")
                        .font(Theme.body(13)).foregroundStyle(Theme.textDim)
                }
                HStack(spacing: 8) {
                    Text("Approve").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 9).background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Text("Not now").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity).padding(.vertical, 9)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line2, lineWidth: 1))
                }
            }
            .padding(14).background(Theme.warnDim)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.warnLine, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.top, 16)
        }
    }

    private func icon(_ action: String) -> String {
        switch action {
        case "AGENT_LOCKED_PLAN": return "lock.fill"
        case "AGENT_GENERATED_BRINGLIST": return "list.bullet"
        case "AGENT_SENT_NONUSER_INVITE": return "message.fill"
        case "AGENT_PROPOSED_PLAN": return "sparkles"
        case "AGENT_GATHERED_AVAILABILITY": return "calendar"
        case "AGENT_RESEARCHED_PLACES": return "mappin.and.ellipse"
        case "PLAN_UNLOCKED": return "arrow.uturn.backward"
        default: return "circle.fill"
        }
    }
    private func relative(_ iso: String) -> String {
        guard let d = parseDate(iso) else { return "" }
        return d.formatted(.dateTime.hour().minute())
    }
}
