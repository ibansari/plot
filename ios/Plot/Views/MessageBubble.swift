import SwiftUI

/// A single chat row. Three styles mirror the mockup: other (avatar + mono name + surface bubble),
/// me (right-aligned mint-tinted bubble), and Plot (✦ mark + accent-bordered plotbubble).
struct MessageBubble: View {
    let message: Message
    let myUserId: String

    private var isMe: Bool { !message.isAgent && message.authorId == myUserId }

    var body: some View {
        if message.isAgent {
            plotRow
        } else if isMe {
            meRow
        } else {
            otherRow
        }
    }

    // Plot
    private var plotRow: some View {
        HStack(alignment: .top, spacing: 9) {
            PlotMark(.s)
            VStack(alignment: .leading, spacing: 4) {
                Text("PLOT").font(Theme.mono(10)).tracking(0.6).foregroundStyle(Theme.accent)
                Text(message.body)
                    .font(Theme.body(13.5))
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 13).padding(.vertical, 11)
                    .background(Theme.surface)
                    .overlay(BubbleShape(corner: .topLeft).stroke(Theme.accentDim2, lineWidth: 1))
                    .clipShape(BubbleShape(corner: .topLeft))
            }
            Spacer(minLength: 28)
        }
    }

    // Other member
    private var otherRow: some View {
        HStack(alignment: .top, spacing: 9) {
            AvatarView(message.authorName ?? "?", size: 30).padding(.top, 14)
            VStack(alignment: .leading, spacing: 3) {
                Text((message.authorName ?? "").uppercased())
                    .font(Theme.mono(10)).tracking(0.5).foregroundStyle(Theme.textFaint)
                    .padding(.leading, 3)
                Text(message.body)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 13).padding(.vertical, 9)
                    .background(Theme.surface)
                    .overlay(BubbleShape(corner: .topLeft).stroke(Theme.line, lineWidth: 1))
                    .clipShape(BubbleShape(corner: .topLeft))
            }
            Spacer(minLength: 40)
        }
    }

    // Me
    private var meRow: some View {
        HStack {
            Spacer(minLength: 40)
            Text(message.body)
                .font(Theme.body(14))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 13).padding(.vertical, 9)
                .background(Theme.me)
                .overlay(BubbleShape(corner: .topRight).stroke(Theme.accent.opacity(0.16), lineWidth: 1))
                .clipShape(BubbleShape(corner: .topRight))
        }
    }
}

/// Chat-bubble shape: 15pt corners except one "tail" corner at 5pt.
struct BubbleShape: Shape {
    enum Corner { case topLeft, topRight }
    let corner: Corner
    func path(in rect: CGRect) -> Path {
        let big: CGFloat = 15, small: CGFloat = 5
        let tl = corner == .topLeft ? small : big
        let tr = corner == .topRight ? small : big
        return Path(roundedRect: rect, cornerRadii: RectangleCornerRadii(
            topLeading: tl, bottomLeading: big, bottomTrailing: big, topTrailing: tr))
    }
}
