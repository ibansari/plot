import SwiftUI

/// Real group members + an inline form to add a member (or invite a non-user by phone, who then
/// votes/RSVPs over SMS). Also previews how that non-user sees the plan.
struct MembersSheet: View {
    let groupId: String
    @Environment(\.dismiss) private var dismiss
    @State private var detail: GroupDetail?
    @State private var showSMS = false

    // add-member form
    @State private var newPhone = ""
    @State private var newName = ""
    @State private var asNonUser = false
    @State private var busy = false

    private let api = APIClient.shared

    var body: some View {
        ZStack {
            Theme.bg2.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(detail.map { "\($0.name) · \($0.members.count) member\($0.members.count == 1 ? "" : "s")" } ?? "Members")
                            .font(Theme.display(20)).foregroundStyle(Theme.text)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
                                .frame(width: 32, height: 32).background(Theme.surface2).clipShape(Circle())
                        }
                    }.padding(.vertical, 12)

                    ForEach(Array((detail?.members ?? []).enumerated()), id: \.offset) { _, m in
                        HStack(spacing: 12) {
                            AvatarView(m.name, size: 38)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.name).font(Theme.body(14, .semibold)).foregroundStyle(Theme.text)
                                Text(memberSub(m)).font(Theme.body(11.5)).foregroundStyle(Theme.textDim)
                            }
                            Spacer()
                            if m.role == "ORGANIZER" { Pill("Admin", .ghost) }
                            else if m.isNonUser { Pill("Non-user", .warn) }
                        }
                        .padding(.vertical, 11)
                        .overlay(Rectangle().fill(Theme.line).frame(height: 1), alignment: .bottom)
                    }

                    if (detail?.members ?? []).contains(where: { $0.isNonUser }) {
                        Button { showSMS = true } label: {
                            Text("👀 Preview how a non-user sees this (SMS)")
                                .font(Theme.body(13.5, .semibold)).foregroundStyle(Theme.text)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line2, lineWidth: 1))
                        }.padding(.vertical, 14)
                    }

                    SectionLabel("Add someone").padding(.top, 10).padding(.bottom, 6)
                    PlotCard {
                        VStack(alignment: .leading, spacing: 12) {
                            field("NAME", "Riley", $newName)
                            field("PHONE", "+15550000123", $newPhone, mono: true)
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Invite as non-user").font(Theme.body(14, .semibold)).foregroundStyle(Theme.text)
                                    Text("They vote / RSVP / pay over SMS — no app").font(Theme.body(11.5)).foregroundStyle(Theme.textDim)
                                }
                                Spacer()
                                Toggle("", isOn: $asNonUser).labelsHidden().tint(Theme.accent)
                            }
                            Button { add() } label: {
                                Text(busy ? "Adding…" : (asNonUser ? "Invite by SMS" : "Add member"))
                                    .font(Theme.body(14, .semibold)).foregroundStyle(Theme.accentInk)
                                    .frame(maxWidth: .infinity).padding(.vertical, 12).background(Theme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 11))
                            }.disabled(newPhone.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                        }.padding(15)
                    }
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 18).padding(.top, 8)
            }
        }
        .preferredColorScheme(.dark)
        .task { detail = try? await api.group(groupId) }
        .sheet(isPresented: $showSMS) { SMSPreviewView() }
    }

    private func memberSub(_ m: GroupDetail.Member) -> String {
        if m.role == "ORGANIZER" { return "Admin · can change Plot's permissions" }
        return m.isNonUser ? "Not on Plot · votes, RSVPs & pays by SMS" : "On Plot"
    }

    private func field(_ label: String, _ placeholder: String, _ text: Binding<String>, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(Theme.mono(11)).foregroundStyle(Theme.textDim)
            TextField(placeholder, text: text)
                .font(mono ? Theme.mono(15) : Theme.body(15)).foregroundStyle(Theme.text)
                .keyboardType(mono ? .phonePad : .default)
        }
    }

    private func add() {
        busy = true
        Task {
            detail = try? await api.addMember(groupId: groupId, phone: newPhone, displayName: newName.isEmpty ? newPhone : newName, asNonUser: asNonUser)
            newPhone = ""; newName = ""; busy = false
        }
    }
}

/// The non-user SMS thread — same plan object, a second surface. Light "iMessage" styling.
struct SMSPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            Theme.bg2.ignoresSafeArea()
            VStack(spacing: 14) {
                HStack {
                    Text("Non-user view").font(Theme.display(20)).foregroundStyle(Theme.text)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
                            .frame(width: 32, height: 32).background(Theme.surface2).clipShape(Circle())
                    }
                }
                Text("They never install anything — they vote, RSVP and (optionally) pay straight from SMS.")
                    .font(Theme.body(12.5)).foregroundStyle(Theme.textDim)
                    .frame(maxWidth: .infinity, alignment: .leading)

                VStack(spacing: 0) {
                    VStack(spacing: 2) {
                        Text("Plot").font(.system(size: 14, weight: .bold)).foregroundStyle(.black)
                        Text("TEXT MESSAGE · VIA YOUR GROUP").font(Theme.mono(9)).foregroundStyle(.gray)
                    }.frame(maxWidth: .infinity).padding(12).background(Color(white: 0.96))

                    VStack(alignment: .leading, spacing: 8) {
                        smsIn("Hey! The crew's sorting Saturday. Vote on what to do 👉 plot.to/v/9fx2")
                        smsOut("1 (games night)")
                        smsIn("Games night it is 🎲 Sat 8pm. RSVP? Reply YES/NO")
                        smsOut("YES")
                        smsIn("You're in 🙌 No booking, just turn up. Snacks chip-in is optional — £4: plot.to/p/9fx2")
                        smsOut("all good, skipping 😄")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14).background(Color.white)
                }
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.line, lineWidth: 1))

                Text("Same plan object, two surfaces. Plot reconciles SMS votes, RSVPs & payments back into the group thread in real time.")
                    .font(Theme.mono(10.5)).foregroundStyle(Theme.textDim).multilineTextAlignment(.center)
                Spacer()
            }
            .padding(18)
        }
        .preferredColorScheme(.dark)
    }

    private func smsIn(_ t: String) -> some View {
        Text(t).font(.system(size: 12.5)).foregroundStyle(.black)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color(white: 0.91)).clipShape(RoundedRectangle(cornerRadius: 16))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func smsOut(_ t: String) -> some View {
        Text(t).font(.system(size: 12.5)).foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color(hex: 0x0A7CFF)).clipShape(RoundedRectangle(cornerRadius: 16))
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
