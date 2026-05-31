import SwiftUI

struct ThreadView: View {
    let group: GroupSummary
    @Bindable var vm: ChatViewModel
    var onBack: () -> Void = {}

    @State private var showDesk = false
    @State private var showMembers = false

    // latest plan referenced in the thread (for the Plot's Desk bar)
    private var latestPlanId: String? {
        vm.messages.last(where: { $0.planId != nil })?.planId
    }
    private var latestPlan: Plan? { latestPlanId.flatMap { vm.plans[$0] } }

    var body: some View {
        VStack(spacing: 0) {
            chatHeader
            if let plan = latestPlan { planBar(plan) }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        Text("TODAY").font(Theme.mono(10)).tracking(1).foregroundStyle(Theme.textFaint)
                            .frame(maxWidth: .infinity)
                        ForEach(vm.messages) { msg in
                            row(msg).id(msg.id)
                        }
                    }
                    .padding(14)
                }
                .onChange(of: vm.messages.count) { _, _ in
                    if let last = vm.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            composer
        }
        .background(Theme.bg)
        .task { await vm.start() }
        .sheet(isPresented: $showDesk) {
            if let id = latestPlanId { PlotDeskView(planId: id, vm: vm) }
        }
        .task(id: showDesk) { if showDesk, let id = latestPlanId { await vm.loadAudit(planId: id) } }
        .sheet(isPresented: $showMembers) { MembersSheet(groupId: group.id) }
        // dev convenience for the simulator demo: auto-open Plot's Desk once a plan is loaded
        .onChange(of: latestPlanId) { _, id in
            if id != nil, ProcessInfo.processInfo.environment["PLOT_DEV_OPENDESK"] == "1" { showDesk = true }
        }
    }

    @ViewBuilder private func row(_ msg: Message) -> some View {
        if msg.kind == .DECISION_CARD, let pid = msg.planId {
            DecisionCardView(planId: pid, vm: vm)
        } else if msg.metadata?.kind == "plot_suggestion" {
            PlotSuggestionView(message: msg, vm: vm)
        } else {
            MessageBubble(message: msg, myUserId: vm.myUserId)
        }
    }

    private var chatHeader: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.textDim)
                    .frame(width: 34, height: 34)
            }
            AvatarStack(Array(group.memberNames.prefix(3)), size: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(group.name).font(Theme.body(16, .bold)).foregroundStyle(Theme.text)
                HStack(spacing: 5) {
                    Circle().fill(Theme.accent).frame(width: 5, height: 5)
                    Text(statusLine.uppercased()).font(Theme.mono(10)).tracking(0.4).foregroundStyle(Theme.accent)
                }
            }
            Spacer()
            iconButton("person.2") { showMembers = true }
        }
        .padding(.horizontal, 12).padding(.bottom, 12).padding(.top, 4)
        .background(Theme.bg.opacity(0.8))
        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
    }

    private var statusLine: String {
        switch latestPlan?.state {
        case .LOCKED, .BOOKED: return "Plot locked the plan"
        case .VOTING: return "Plot is gathering votes"
        case .PROPOSED: return "Plot drafted some options"
        default: return "Plot's keeping an eye out"
        }
    }

    private func iconButton(_ system: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system).font(.system(size: 17)).foregroundStyle(Theme.textDim)
                .frame(width: 34, height: 34)
        }
    }

    private func planBar(_ plan: Plan) -> some View {
        Button { showDesk = true } label: {
            HStack(spacing: 12) {
                PlotMark(.m)
                VStack(alignment: .leading, spacing: 2) {
                    Text(planBarTitle(plan)).font(Theme.body(13.5, .bold)).foregroundStyle(Theme.text)
                    Text(planBarSub(plan)).font(Theme.mono(10.5)).tracking(0.3).foregroundStyle(Theme.textDim)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textFaint)
            }
            .padding(.horizontal, 14).padding(.vertical, 13)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.accentDim2, lineWidth: 1))
            .overlay(Rectangle().fill(Theme.accent).frame(width: 3), alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12).padding(.top, 12)
    }

    private func planBarTitle(_ plan: Plan) -> String {
        if plan.state == .LOCKED || plan.state == .BOOKED, let place = plan.lockedPlace {
            let t = plan.lockedTime.flatMap(parseDate)?.formatted(.dateTime.weekday(.abbreviated).hour().minute()) ?? ""
            return "\(plan.title) · \(t) · \(place)"
        }
        return plan.title
    }
    private func planBarSub(_ plan: Plan) -> String {
        "Plot's Desk · \(plan.state.rawValue) · no booking"
    }

    private var composer: some View {
        HStack(spacing: 9) {
            Text("+").font(.system(size: 24, weight: .light)).foregroundStyle(Theme.accent).frame(width: 30, height: 30)
            TextField("Message The Crew…", text: $vm.draft, axis: .vertical)
                .font(Theme.body(14)).foregroundStyle(Theme.text)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(Theme.surface)
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .clipShape(Capsule())
            Button { Task { await vm.send() } } label: {
                PlotMark(.m).overlay(
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent)
                ).frame(width: 42, height: 42)
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 26)
        .background(Theme.bg.opacity(0.86))
        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .top)
    }
}

private struct PlotSuggestionView: View {
    let message: Message
    @Bindable var vm: ChatViewModel

    private var status: String { message.metadata?.status ?? "open" }

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            PlotMark(.s)
            PlotCard {
                VStack(alignment: .leading, spacing: 11) {
                    Text(message.body).font(Theme.body(13.5, .semibold)).foregroundStyle(Theme.text)
                    if status == "open" {
                        HStack(spacing: 8) {
                            Button { Task { await vm.actOnSuggestion(messageId: message.id, action: "draft_options") } } label: {
                                Text("Draft options").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                                    .frame(maxWidth: .infinity).padding(.vertical, 9).background(Theme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            Button { Task { await vm.actOnSuggestion(messageId: message.id, action: "dismiss") } } label: {
                                Text("Not now").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.textDim)
                                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line2, lineWidth: 1))
                            }
                        }
                    } else {
                        Text(status == "accepted" ? "Drafting options…" : "No rush.")
                            .font(Theme.mono(10.5)).foregroundStyle(Theme.textFaint)
                    }
                }
                .padding(13)
            }
            Spacer(minLength: 12)
        }
    }
}
