import SwiftUI

/// The app shell: Chats / Plans / Discover / You, with the mockup's mono tab bar. Fully
/// data-driven — the Chats list, group membership and plans all come from the API. Opening a group
/// pushes the full group-chat screen (which replaces the tab bar with the composer).
struct MainTabView: View {
    let session: Session
    @State private var tab: Tab = .chats
    @State private var groups = GroupsViewModel()
    @State private var openGroup: GroupSummary?
    @State private var threadVM: ChatViewModel?
    @State private var showNewGroup = false

    enum Tab: String, CaseIterable { case chats, plans, discover, you }

    init(session: Session) { self.session = session }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if let g = openGroup, let vm = threadVM {
                ThreadView(group: g, vm: vm, onBack: { openGroup = nil; threadVM = nil; Task { await groups.load() } })
            } else {
                VStack(spacing: 0) { content; tabBar }
            }
        }
        .sheet(isPresented: $showNewGroup) {
            NewGroupView(groups: groups) { created in showNewGroup = false; open(created) }
        }
        .task {
            await groups.load()
            await syncDeviceState()
            // dev convenience: jump straight into the first group's thread
            if ProcessInfo.processInfo.environment["PLOT_DEV_OPENCREW"] == "1", let first = groups.groups.first {
                open(first)
            }
        }
    }

    private func open(_ g: GroupSummary) {
        guard let tid = g.threadId else { return }
        threadVM = ChatViewModel(threadId: tid, myUserId: session.user.id)
        openGroup = g
    }

    @ViewBuilder private var content: some View {
        switch tab {
        case .chats: ChatsListView(groups: groups, onOpen: open, onNew: { showNewGroup = true })
        case .plans: PlansView(groups: groups.groups)
        case .discover: DiscoverView(onPlan: { tab = .chats })
        case .you: YouView(session: session)
        }
    }

    private var tabBar: some View {
        HStack(alignment: .top) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button { tab = t } label: {
                    VStack(spacing: 4) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: icon(t)).font(.system(size: 20))
                            if t == .chats, groups.groups.contains(where: { $0.needsYou }) {
                                Circle().fill(Theme.accent).frame(width: 7, height: 7).offset(x: 6, y: -2)
                            }
                        }
                        Text(t.rawValue.uppercased()).font(Theme.mono(10)).tracking(0.5)
                    }
                    .foregroundStyle(tab == t ? Theme.accent : Theme.textFaint)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.top, 10).padding(.bottom, 22).padding(.horizontal, 8)
        .background(Theme.bg.opacity(0.72))
        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .top)
    }

    private func icon(_ t: Tab) -> String {
        switch t {
        case .chats: return "bubble.left.and.bubble.right"
        case .plans: return "calendar"
        case .discover: return "sparkles"
        case .you: return "person"
        }
    }

    // Best-effort: push this device's busy/free (EventKit) + register for push. Failures are ignored
    // (e.g. calendar permission denied in the simulator) — the app still works.
    private func syncDeviceState() async {
        try? await APIClient.shared.registerDevice(apnsToken: "mock-apns-\(session.user.id)")
        if ProcessInfo.processInfo.environment["PLOT_DEV_NOSYNC"] == "1" { return } // skip launch prompt in demos
        let ek = EventKitService()
        if await ek.requestAccess() {
            let now = Date()
            let intervals = ek.busyIntervals(from: now, to: now.addingTimeInterval(14 * 86400))
            try? await APIClient.shared.syncAvailability(intervals)
        }
    }
}

// MARK: - Chats list (real groups)
struct ChatsListView: View {
    @Bindable var groups: GroupsViewModel
    var onOpen: (GroupSummary) -> Void
    var onNew: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Chats").font(Theme.display(29)).foregroundStyle(Theme.text)
                    Text("\(groups.groups.count) group\(groups.groups.count == 1 ? "" : "s") · Plot's keeping an eye out")
                        .font(Theme.body(13)).foregroundStyle(Theme.textDim)
                }
                Spacer()
                Button(action: onNew) {
                    PlotMark(.m).overlay(Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.accent))
                }
            }.padding(.horizontal, 22).padding(.top, 8).padding(.bottom, 16)

            if groups.groups.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(groups.groups) { g in chatRow(g) }
                    }.padding(.horizontal, 12).padding(.bottom, 12)
                }
                .refreshable { await groups.load() }
            }
            Spacer()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            PlotMark(.m)
            Text("No groups yet").font(Theme.display(18)).foregroundStyle(Theme.text)
            Text("Start a group and invite your friends — even ones without the app.")
                .font(Theme.body(13)).foregroundStyle(Theme.textDim).multilineTextAlignment(.center)
            Button(action: onNew) {
                Text("New group").font(Theme.body(14, .semibold)).foregroundStyle(Theme.accentInk)
                    .padding(.horizontal, 18).padding(.vertical, 11).background(Theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Spacer()
        }.frame(maxWidth: .infinity).padding(.horizontal, 40)
    }

    private func chatRow(_ g: GroupSummary) -> some View {
        Button { onOpen(g) } label: {
            HStack(spacing: 13) {
                AvatarStack(Array(g.memberNames.prefix(3)), size: 38)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(g.name).font(Theme.body(15.5, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Text("NOW").font(Theme.mono(10)).foregroundStyle(Theme.textFaint)
                    }
                    Text(lastLine(g)).font(Theme.body(13)).foregroundStyle(Theme.textDim).lineLimit(1)
                    HStack(spacing: 6) {
                        if g.needsYou { Pill("Plot needs you", .warn) }
                        if let p = g.activePlan { Pill(p.state, p.state == "LOCKED" || p.state == "BOOKED" ? .ok : .ghost) }
                    }.padding(.top, 3)
                }
                if g.needsYou { Circle().fill(Theme.accent).frame(width: 8, height: 8) }
            }
            .padding(.horizontal, 12).padding(.vertical, 14)
        }
        .buttonStyle(.plain)
    }

    private func lastLine(_ g: GroupSummary) -> String {
        if let m = g.lastMessage { return (m.isAgent ? "Plot: " : "") + m.body }
        return "Say hi 👋"
    }
}

// MARK: - New group
struct NewGroupView: View {
    @Bindable var groups: GroupsViewModel
    var onCreated: (GroupSummary) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false

    var body: some View {
        ZStack {
            Theme.bg2.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("New group").font(Theme.display(20)).foregroundStyle(Theme.text)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
                            .frame(width: 32, height: 32).background(Theme.surface2).clipShape(Circle())
                    }
                }
                PlotCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("GROUP NAME").font(Theme.mono(11)).foregroundStyle(Theme.textDim)
                        TextField("The Crew", text: $name)
                            .font(Theme.body(17)).foregroundStyle(Theme.text)
                    }.padding(16)
                }
                Button {
                    busy = true
                    Task { if let g = await groups.create(name: name) { onCreated(g) }; busy = false }
                } label: {
                    Text(busy ? "Creating…" : "Create group")
                        .font(Theme.body(15, .semibold)).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 14).background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                Text("You'll be the organizer. Invite members (and non-users by phone) from the group's members sheet.")
                    .font(Theme.body(12)).foregroundStyle(Theme.textDim)
                Spacer()
            }.padding(18)
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Plans (real active plans across groups)
struct PlansView: View {
    let groups: [GroupSummary]
    private var active: [GroupSummary] { groups.filter { $0.activePlan != nil } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Plans").font(Theme.display(29)).foregroundStyle(Theme.text)
                Text("Everything you're actually doing, across every group").font(Theme.body(13)).foregroundStyle(Theme.textDim)
            }.padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 14)
            if active.isEmpty {
                Spacer()
                Text("No active plans yet — start one in a group chat.")
                    .font(Theme.body(13)).foregroundStyle(Theme.textDim).frame(maxWidth: .infinity)
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(active) { g in
                            PlotCard {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(g.activePlan!.title).font(Theme.body(15, .bold)).foregroundStyle(Theme.text)
                                    Text(g.name).font(Theme.body(12)).foregroundStyle(Theme.textDim)
                                    HStack {
                                        Pill(g.activePlan!.state, g.activePlan!.state == "LOCKED" || g.activePlan!.state == "BOOKED" ? .ok : .ghost)
                                        if g.needsYou { Pill("needs you", .warn) }
                                    }
                                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }.padding(.horizontal, 16).padding(.bottom, 16)
                }
            }
            Spacer()
        }
    }
}

// MARK: - Discover (illustrative)
struct DiscoverView: View {
    var onPlan: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Discover").font(Theme.display(29)).foregroundStyle(Theme.text)
                Text("Tuned to your groups' taste & season").font(Theme.body(13)).foregroundStyle(Theme.textDim)
            }.padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 14)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PlotCard(accentBorder: true) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Who's around right now?").font(Theme.display(19)).foregroundStyle(Theme.text)
                            Text("Broadcast you're free tonight. Plot pings whoever's also up for it.")
                                .font(Theme.body(12.5)).foregroundStyle(Theme.textDim)
                            HStack { Spacer(); Button(action: onPlan) {
                                Text("I'm free →").font(Theme.body(12.5, .bold)).foregroundStyle(Theme.accentInk)
                                    .padding(.horizontal, 13).padding(.vertical, 8).background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 10))
                            } }
                        }.padding(17)
                    }
                }.padding(.horizontal, 16).padding(.bottom, 16)
            }
        }
    }
}

// MARK: - You (real trust-model settings)
struct YouView: View {
    let session: Session
    @State private var capCents: Int = 5000
    @State private var book = false
    @State private var calendar = true
    @State private var textNonusers = true
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("You").font(Theme.display(29)).foregroundStyle(Theme.text).padding(.top, 8)
                HStack(spacing: 14) {
                    AvatarView(session.user.displayName, size: 52)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.user.displayName).font(Theme.display(22)).foregroundStyle(Theme.text)
                        Text("\(session.user.phone ?? "—")").font(Theme.mono(11)).foregroundStyle(Theme.textDim)
                    }
                    Spacer()
                }

                section("What Plot may do on its own") {
                    permRow("Add plans to my calendar", "Reads busy/free only", $calendar) { setScope("CALENDAR_BUSYFREE", $0) }
                    permRow("Book & buy tickets", "Reservations, lanes, tickets when needed", $book) { setScope("SPEND_MONEY", $0) }
                    permRow("Text non-members", "SMS people in the plan who aren't on Plot", $textNonusers) { setScope("SEND_NONUSER_INVITE", $0) }
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Text("Spend cap before asking me").font(Theme.body(14, .semibold)).foregroundStyle(Theme.text)
                            Spacer()
                            Text("$\(capCents / 100)").font(Theme.display(20)).foregroundStyle(Theme.accent)
                        }
                        Slider(value: Binding(get: { Double(capCents) }, set: { capCents = Int($0) }),
                               in: 0...20000, step: 500) { editing in
                            if !editing { Task { _ = try? await APIClient.shared.setSpendCap(cents: capCents) } }
                        }.tint(Theme.accent)
                        Text("Anything over $\(capCents / 100) pauses for your approval. Everything Plot does is logged & reversible.")
                            .font(Theme.body(11.5)).foregroundStyle(Theme.textDim)
                    }.padding(15).overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .top)
                }
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .task {
            guard !loaded else { return }
            loaded = true
            capCents = session.user.defaultSpendCapCents ?? 5000
            if let me = try? await APIClient.shared.me() { capCents = me.defaultSpendCapCents ?? capCents }
            if let perms = try? await APIClient.shared.permissions() {
                func g(_ s: String) -> Bool { perms.first { $0.scope == s }?.granted ?? false }
                calendar = g("CALENDAR_BUSYFREE"); book = g("SPEND_MONEY"); textNonusers = g("SEND_NONUSER_INVITE")
            }
        }
    }

    private func setScope(_ scope: String, _ granted: Bool) {
        Task { try? await APIClient.shared.setPermission(scope: scope, granted: granted) }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(title).padding(.horizontal, 15).padding(.top, 12).padding(.bottom, 8)
            content()
        }
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func permRow(_ a: String, _ b: String, _ on: Binding<Bool>, onChange: @escaping (Bool) -> Void) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(a).font(Theme.body(14, .semibold)).foregroundStyle(Theme.text)
                Text(b).font(Theme.body(11.5)).foregroundStyle(Theme.textDim)
            }
            Spacer()
            Toggle("", isOn: on).labelsHidden().tint(Theme.accent)
                .onChange(of: on.wrappedValue) { _, v in onChange(v) }
        }
        .padding(.horizontal, 15).padding(.vertical, 12)
        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .top)
    }
}
