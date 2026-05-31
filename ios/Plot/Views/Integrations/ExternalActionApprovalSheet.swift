import SwiftUI

/// Approval sheet for a previewed external mutation. Distinguishes free holds, paid purchases, and
/// irreversible actions (which carry an explicit "Plot cannot undo this" warning). Approving calls
/// the gateway, which executes and returns a receipt. (Spec §Transaction Lifecycle.)
struct ExternalActionApprovalSheet: View {
    let envelope: RenderEnvelope    // an APPROVAL-renderer envelope
    var onApproved: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var working = false
    @State private var error: String?

    private var risk: String { envelope.risk ?? "WRITE" }
    private var irreversible: Bool { risk == "IRREVERSIBLE" }
    private var paid: Bool { risk == "PURCHASE" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: irreversible ? "exclamationmark.triangle.fill" : "checkmark.shield")
                    .foregroundStyle(irreversible ? Theme.danger : Theme.accent)
                Text(envelope.title).font(Theme.body(18)).fontWeight(.semibold).foregroundStyle(Theme.text)
            }

            riskBanner

            if let fields = envelope.fields {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(fields, id: \.label) { f in
                        HStack { Text(f.label).foregroundStyle(Theme.textFaint); Spacer(); Text(f.value).foregroundStyle(Theme.text) }
                            .font(Theme.body(13))
                    }
                }
                .padding(12).background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
            }

            if let links = envelope.links {
                ForEach(links, id: \.url) { l in
                    Button { if let u = URL(string: l.url) { openURL(u) } } label: {
                        Label(l.label, systemImage: "link").font(Theme.body(13)).foregroundStyle(Theme.accent)
                    }
                }
            }

            if let error { Text(error).font(Theme.body(12)).foregroundStyle(Theme.danger) }

            Spacer()

            HStack(spacing: 12) {
                Button("Not now") { dismiss() }
                    .font(Theme.body(15)).foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Theme.surface3, in: Capsule())
                Button(action: approve) {
                    Text(working ? "Working…" : (irreversible ? "Approve — cannot undo" : paid ? "Approve & pay" : "Approve"))
                        .font(Theme.body(15)).fontWeight(.semibold).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(irreversible ? Theme.danger : Theme.accent, in: Capsule())
                }
                .disabled(working)
            }
        }
        .padding(20)
        .presentationDetents([.medium])
    }

    @ViewBuilder private var riskBanner: some View {
        let (text, color): (String, Color) = irreversible
            ? ("This can't be undone by Plot. Check the provider's policy before approving.", Theme.danger)
            : paid
                ? ("This is a paid action and needs organizer approval.", Theme.warn)
                : ("A free hold — any member can approve.", Theme.textDim)
        Text(text).font(Theme.body(13)).foregroundStyle(color)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }

    private func approve() {
        guard let approvalId = envelope.actions?.first(where: { $0.id == "approve" })?.approvalId else { return }
        working = true; error = nil
        Task {
            do {
                _ = try await APIClient.shared.approveExternalAction(approvalId: approvalId)
                onApproved?(); dismiss()
            } catch { self.error = "Couldn't approve: \(error.localizedDescription)"; working = false }
        }
    }
}
