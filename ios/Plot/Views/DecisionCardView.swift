import SwiftUI

/// The Plot decision card moves from editable draft → voting → locked RSVP/logistics.
struct DecisionCardView: View {
    let planId: String
    @Bindable var vm: ChatViewModel
    @State private var myVotes: [String: String] = [:]   // optionId → "UP"/"DOWN" (local highlight)
    @State private var showDesk = false
    @State private var showAddOption = false
    @State private var newOption = ""
    @Environment(\.openURL) private var openURL

    private var plan: Plan? { vm.plans[planId] }

    var body: some View {
        Group {
            if let plan {
                if plan.state == .PROPOSED {
                    draftView(plan)
                } else if plan.state == .LOCKED || plan.state == .BOOKED {
                    lockedView(plan)
                } else {
                    votingView(plan)
                }
            } else {
                PlotCard { Text("Loading plan…").font(Theme.body(13)).foregroundStyle(Theme.textDim).padding(16) }
            }
        }
        .sheet(isPresented: $showDesk) { PlotDeskView(planId: planId, vm: vm) }
        .task(id: showDesk) { if showDesk { await vm.loadAudit(planId: planId) } }
        .alert("Add an option", isPresented: $showAddOption) {
            TextField("What should the group consider?", text: $newOption)
            Button("Cancel", role: .cancel) { newOption = "" }
            Button("Add") {
                let label = newOption.trimmingCharacters(in: .whitespacesAndNewlines)
                newOption = ""
                if !label.isEmpty { Task { await vm.addOption(planId: planId, label: label) } }
            }
        }
    }

    // MARK: DRAFT
    @ViewBuilder private func draftView(_ plan: Plan) -> some View {
        HStack(alignment: .top, spacing: 9) {
            PlotMark(.s)
            VStack(alignment: .leading, spacing: 10) {
                PlotCard {
                    VStack(spacing: 0) {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 7) {
                                PlotMark(.xs)
                                Text("DRAFT · SHAPE THE OPTIONS")
                                    .font(Theme.mono(10)).tracking(0.8).foregroundStyle(Theme.accent)
                            }
                            Text(plan.title).font(Theme.display(18)).foregroundStyle(Theme.text)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 15).padding(.vertical, 13)
                        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)

                        ForEach(plan.options) { opt in
                            HStack(alignment: .top, spacing: 10) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(opt.label).font(Theme.body(14.5, .bold)).foregroundStyle(Theme.text)
                                    Text(metaLine(opt)).font(Theme.mono(10.5)).foregroundStyle(Theme.textDim)
                                    if let why = opt.why, !why.isEmpty {
                                        Text(why).font(Theme.body(11.5)).foregroundStyle(Theme.accent)
                                    }
                                }
                                Spacer(minLength: 0)
                                if plan.options.count > 2 {
                                    Button { Task { await vm.removeOption(planId: plan.id, optionId: opt.id) } } label: {
                                        Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.textDim)
                                            .frame(width: 28, height: 28)
                                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line2, lineWidth: 1))
                                    }
                                }
                            }
                            .padding(.horizontal, 15).padding(.vertical, 12)
                            .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                        }

                        HStack(spacing: 8) {
                            ghostButton("Add option") { showAddOption = true }
                            Button { Task { await vm.startVote(planId: plan.id) } } label: {
                                Text("Start vote").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                                    .frame(maxWidth: .infinity).padding(.vertical, 9).background(Theme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        .padding(12)
                    }
                }
            }
            Spacer(minLength: 12)
        }
    }

    // MARK: VOTING
    @ViewBuilder private func votingView(_ plan: Plan) -> some View {
        let leaderId = leaderOptionId(plan)
        HStack(alignment: .top, spacing: 9) {
            PlotMark(.s)
            VStack(alignment: .leading, spacing: 10) {
                PlotCard {
                    VStack(spacing: 0) {
                        // chead
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 7) {
                                PlotMark(.xs)
                                Text("\(plan.options.count) IDEAS · PICK ONE")
                                    .font(Theme.mono(10)).tracking(0.8).foregroundStyle(Theme.accent)
                            }
                            Text(plan.title).font(Theme.display(18)).foregroundStyle(Theme.text)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 15).padding(.vertical, 13)
                        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)

                        ForEach(plan.options) { opt in
                            optionRow(plan, opt, isLeader: opt.id == leaderId)
                        }

                        // cfoot
                        HStack {
                            Text("↑ BOOST · ↓ VETO · \(votedCount(plan)) OF \(plan.rsvps.count == 0 ? 5 : plan.rsvps.count) VOTED")
                                .font(Theme.mono(10)).tracking(0.4).foregroundStyle(Theme.textDim)
                            Spacer()
                            Button { showDesk = true } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "slider.horizontal.3").font(.system(size: 10))
                                    Text("Plot's Desk").font(Theme.body(11.5, .semibold))
                                }.foregroundStyle(Theme.accent)
                            }
                        }
                        .padding(.horizontal, 15).padding(.vertical, 11)
                        .frame(maxWidth: .infinity)
                        .background(Theme.surface2)
                    }
                }
                deadlineBanner(plan)
            }
            Spacer(minLength: 12)
        }
    }

    private func optionRow(_ plan: Plan, _ opt: PlanOption, isLeader: Bool) -> some View {
        let tally = plan.tally(opt.id)
        let mine = myVotes[opt.id] ?? (plan.viewerVote?.optionId == opt.id ? plan.viewerVote?.value : nil)
        return VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    if isLeader {
                        Text("TOP").font(Theme.mono(8.5)).tracking(0.8).foregroundStyle(Theme.accent)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Theme.accentDim)
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.accentDim2, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    Text(opt.label).font(Theme.body(14.5, .bold)).foregroundStyle(Theme.text)
                    Text(metaLine(opt)).font(Theme.mono(10.5)).foregroundStyle(Theme.textDim)
                    if let why = opt.why, !why.isEmpty {
                        Text(why).font(Theme.body(11.5)).foregroundStyle(Theme.accent).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(opt.fitFlags ?? [], id: \.self) { flag in
                        Text("⚠ \(flag)").font(Theme.mono(9.5)).foregroundStyle(Theme.warn)
                    }
                    rtag(opt)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 7) {
                    HStack(spacing: 5) {
                        voteButton("↑", on: mine == "UP", accent: true) { Task { await cast(plan.id, opt.id, "UP") } }
                        voteButton("↓", on: mine == "DOWN", accent: false) { Task { await cast(plan.id, opt.id, "DOWN") } }
                    }
                    Text("\(tally?.up ?? 0)").font(Theme.mono(10.5)).foregroundStyle(Theme.textDim)
                }
            }
            .padding(.horizontal, 15).padding(.vertical, 13)
            .background(isLeader ? Theme.accent.opacity(0.06) : Color.clear)
        }
        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
    }

    private func voteButton(_ glyph: String, on: Bool, accent: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: 13, weight: .bold))
                .foregroundStyle(on ? Theme.accentInk : (accent ? Theme.accent : Theme.textDim))
                .frame(width: 30, height: 30)
                .background(on ? Theme.accent : Theme.surface2)
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(accent ? Theme.accentDim2 : Theme.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 9))
        }
    }

    @ViewBuilder private func rtag(_ opt: PlanOption) -> some View {
        let booking = opt.place != nil && opt.priceTier != nil
        if booking {
            Text("Plot books · taps-to-call if needed")
                .font(Theme.mono(9.5)).tracking(0.4).foregroundStyle(Theme.textFaint)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.line2, lineWidth: 1))
        } else {
            Text("No booking — just bring stuff")
                .font(Theme.mono(9.5)).tracking(0.4).foregroundStyle(Theme.accent)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Theme.accentDim)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.accentDim2, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    @ViewBuilder private func deadlineBanner(_ plan: Plan) -> some View {
        if let deadline = plan.softDeadline.flatMap(parseDate) {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let remaining = max(0, Int(deadline.timeIntervalSince(ctx.date)))
                HStack(spacing: 10) {
                    Image(systemName: "timer").font(.system(size: 14)).foregroundStyle(Theme.warn)
                    (Text("Leading idea wins. I'll ")
                        + Text("lock it").font(Theme.body(12.5, .bold)).foregroundColor(Theme.text)
                        + Text(remaining > 0 ? " in \(remaining)s unless someone shouts. Nothing to book — I'll sort headcount & who brings what." : " now…"))
                        .font(Theme.body(12.5)).foregroundStyle(Theme.warn)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 13).padding(.vertical, 10)
                .background(Theme.warnDim)
                .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.warnLine, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 13))
            }
        }
    }

    // MARK: LOCKED
    @ViewBuilder private func lockedView(_ plan: Plan) -> some View {
        HStack(alignment: .top, spacing: 9) {
            PlotMark(.s)
            VStack(alignment: .leading, spacing: 10) {
                Text("PLOT").font(Theme.mono(10)).tracking(0.6).foregroundStyle(Theme.accent)
                PlotCard {
                    VStack(spacing: 0) {
                        // confirm top
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(Theme.accentDim).overlay(Circle().stroke(Theme.accentDim2, lineWidth: 1))
                                Image(systemName: "lock.fill").font(.system(size: 16)).foregroundStyle(Theme.accent)
                            }.frame(width: 40, height: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Locked — \(plan.title)").font(Theme.body(14.5, .bold)).foregroundStyle(Theme.text)
                                Text("No booking needed · added to everyone's calendar")
                                    .font(Theme.body(11.5)).foregroundStyle(Theme.textDim)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(15)
                        .overlay(Rectangle().fill(Theme.line2).frame(height: 1), alignment: .bottom)

                        VStack(spacing: 9) {
                            detRow("When", plan.lockedTime.flatMap(parseDate).map { $0.formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? "—")
                            detRow("Where", plan.lockedPlace ?? "—")
                            detRow("Who", "\(goingCount(plan)) going")
                            if let ref = plan.bookingRef { detRow("Booked", ref) }
                        }
                        .padding(15)

                        bookingActions(plan)
                        rsvpActions(plan)

                        HStack(spacing: 8) {
                            ghostButton("Directions") {}
                            ghostButton("Plot's Desk") { showDesk = true }
                        }
                        .padding(.horizontal, 15).padding(.bottom, 14)
                    }
                }
                splitCard(plan)
                bringList(plan)
            }
            Spacer(minLength: 12)
        }
    }

    @ViewBuilder private func rsvpActions(_ plan: Plan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CAN YOU MAKE IT?").font(Theme.mono(10)).tracking(0.6).foregroundStyle(Theme.textDim)
            HStack(spacing: 7) {
                rsvpButton("I'm in", status: "YES", plan: plan)
                rsvpButton("Maybe", status: "MAYBE", plan: plan)
                rsvpButton("Can't make it", status: "NO", plan: plan)
            }
        }
        .padding(.horizontal, 15).padding(.bottom, 12)
    }

    private func rsvpButton(_ title: String, status: String, plan: Plan) -> some View {
        let selected = plan.viewerRsvp == status
        return Button { Task { await vm.rsvp(planId: plan.id, status: status) } } label: {
            Text(title).font(Theme.body(11.5, .bold)).foregroundStyle(selected ? Theme.accentInk : Theme.text)
                .frame(maxWidth: .infinity).padding(.vertical, 8)
                .background(selected ? Theme.accent : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? Theme.accent : Theme.line2, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    // Booking: a confirmed badge, or a Book button (organizer), or a tap-to-call fallback.
    @ViewBuilder private func bookingActions(_ plan: Plan) -> some View {
        if let ref = plan.bookingRef {
            HStack(spacing: 7) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 13)).foregroundStyle(Theme.accent)
                Text("Secured · \(ref)").font(Theme.mono(11)).foregroundStyle(Theme.accent)
                Spacer()
            }.padding(.horizontal, 15).padding(.bottom, 12)
        } else if plan.state == .LOCKED {
            HStack(spacing: 8) {
                if let fb = plan.bookingFallback, !fb.value.isEmpty {
                    ghostButton(fb.label) {
                        if fb.kind == "call", let url = URL(string: "tel://\(fb.value)") { openURL(url) }
                        else if let url = URL(string: fb.value) { openURL(url) }
                    }
                }
                Button { Task { await vm.book(planId: plan.id) } } label: {
                    Text("Book it").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 9).background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }.padding(.horizontal, 15).padding(.bottom, 12)
        }
    }

    // Even-split summary with a "Pay my share" action (escrow held until everyone's in).
    @ViewBuilder private func splitCard(_ plan: Plan) -> some View {
        if let split = plan.split {
            PlotCard {
                VStack(spacing: 0) {
                    HStack {
                        Text(split.memo ?? "Split").font(Theme.body(13.5, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Text("$\(perHead(split))/person").font(Theme.display(15)).foregroundStyle(Theme.accent)
                    }
                    .padding(.horizontal, 15).padding(.vertical, 12)
                    .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                    ForEach(Array(split.shares.enumerated()), id: \.offset) { _, s in
                        HStack(spacing: 10) {
                            AvatarView(s.name, size: 24)
                            Text(s.name + (s.isNonUser ? " · SMS" : "")).font(Theme.body(13)).foregroundStyle(Theme.text)
                            Spacer()
                            Text(s.paid ? "paid" : "due").font(Theme.mono(10)).foregroundStyle(s.paid ? Theme.accent : Theme.warn)
                        }
                        .padding(.horizontal, 15).padding(.vertical, 8)
                        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                    }
                    Button { Task { await vm.paySplit(planId: plan.id, splitId: split.id) } } label: {
                        Text(split.state == "CAPTURED" ? "Settled ✓" : "Pay my share")
                            .font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                            .frame(maxWidth: .infinity).padding(.vertical, 11).background(Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }.disabled(split.state == "CAPTURED").padding(12)
                }
            }
        }
    }

    private func perHead(_ s: SplitDTO) -> Int {
        s.shares.first.map { $0.amountCents / 100 } ?? (s.totalCents / max(s.shares.count, 1) / 100)
    }

    @ViewBuilder private func bringList(_ plan: Plan) -> some View {
        if !plan.bringList.isEmpty {
            PlotCard {
                VStack(spacing: 0) {
                    HStack {
                        Text("Who's bringing what").font(Theme.body(13.5, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Pill("Plot sorted it", .plot)
                    }
                    .padding(.horizontal, 15).padding(.vertical, 12)
                    .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                    ForEach(plan.bringList) { item in
                        HStack(spacing: 10) {
                            Text("✦").font(.system(size: 12)).foregroundStyle(Theme.accent)
                            Text(item.label).font(Theme.body(13)).foregroundStyle(Theme.text)
                            Spacer()
                            if item.generated { Text("auto").font(Theme.mono(9.5)).foregroundStyle(Theme.textFaint) }
                        }
                        .padding(.horizontal, 15).padding(.vertical, 9)
                        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                    }
                }
            }
        }
    }

    private func detRow(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k.uppercased()).font(Theme.mono(11)).tracking(0.5).foregroundStyle(Theme.textDim)
            Spacer()
            Text(v).font(Theme.body(13, .semibold)).foregroundStyle(Theme.text)
        }
    }

    private func ghostButton(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(Theme.body(12.5, .bold)).foregroundStyle(Theme.text)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line2, lineWidth: 1))
        }
    }

    // MARK: helpers
    private func cast(_ planId: String, _ optionId: String, _ value: String) async {
        myVotes[optionId] = value
        await vm.vote(planId: planId, optionId: optionId, value: value)
    }
    private func leaderOptionId(_ plan: Plan) -> String? {
        plan.options.max { a, b in score(plan, a) < score(plan, b) }?.id
    }
    private func score(_ plan: Plan, _ o: PlanOption) -> Int {
        let t = plan.tally(o.id); return (t?.up ?? 0) - (t?.down ?? 0)
    }
    private func votedCount(_ plan: Plan) -> Int {
        Set(plan.votes.filter { $0.up + $0.down > 0 }.map { $0.optionId }).isEmpty
            ? plan.votes.reduce(0) { $0 + $1.up + $1.down } : plan.votes.reduce(0) { $0 + $1.up + $1.down }
    }
    private func goingCount(_ plan: Plan) -> Int {
        plan.rsvps.filter { $0.status == "YES" }.count
    }
    private func metaLine(_ opt: PlanOption) -> String {
        var parts = [opt.kind.rawValue]
        if let t = opt.startsAt.flatMap(parseDate) { parts.append(t.formatted(.dateTime.weekday(.abbreviated).hour().minute())) }
        if let tier = opt.priceTier { parts.append(String(repeating: "$", count: tier)) }
        return parts.joined(separator: "  ·  ")
    }
}

func parseDate(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
}
