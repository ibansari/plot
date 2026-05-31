import SwiftUI

/// The ✦ Plot mark — a rounded-square chip with accent-dim fill + border (and a soft glow),
/// exactly as in the mockup. Three sizes.
public struct PlotMark: View {
    public enum Size { case xs, s, m }
    let size: Size
    public init(_ size: Size = .m) { self.size = size }

    private var dim: CGFloat { switch size { case .xs: return 17; case .s: return 24; case .m: return 30 } }
    private var radius: CGFloat { switch size { case .xs: return 5; case .s: return 7; case .m: return 9 } }
    private var glyph: CGFloat { switch size { case .xs: return 9; case .s: return 12; case .m: return 15 } }

    public var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .fill(Theme.accentDim)
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Theme.accentDim2, lineWidth: 1))
            .overlay(Text("✦").font(.system(size: glyph)).foregroundStyle(Theme.accent))
            .frame(width: dim, height: dim)
            .shadow(color: Theme.accent.opacity(0.18), radius: 7)
    }
}

/// A circular avatar with the member's initial, colored from the mockup palette.
public struct AvatarView: View {
    let name: String
    let size: CGFloat
    public init(_ name: String, size: CGFloat = 30) { self.name = name; self.size = size }

    public var body: some View {
        Circle()
            .fill(Theme.avatarColor(name))
            .overlay(Text(String(name.prefix(1)).uppercased())
                .font(Theme.body(size * 0.42, .bold))
                .foregroundStyle(Color(hex: 0x0B0D10)))
            .frame(width: size, height: size)
            .overlay(Circle().stroke(Theme.bg, lineWidth: 2))
    }
}

/// Overlapping avatar stack.
public struct AvatarStack: View {
    let names: [String]
    let size: CGFloat
    public init(_ names: [String], size: CGFloat = 30) { self.names = names; self.size = size }
    public var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, n in AvatarView(n, size: size) }
        }
    }
}

/// A mono, technical pill. Variants mirror the mockup.
public struct Pill: View {
    public enum Kind { case plot, warn, ok, ghost }
    let text: String
    let kind: Kind
    public init(_ text: String, _ kind: Kind = .ghost) { self.text = text; self.kind = kind }

    private var fg: Color { switch kind { case .plot, .ok: return Theme.accent; case .warn: return Theme.warn; case .ghost: return Theme.textDim } }
    private var bg: Color { switch kind { case .plot, .ok: return Theme.accentDim; case .warn: return Theme.warnDim; case .ghost: return Theme.surface2 } }
    private var border: Color { switch kind { case .plot, .ok: return Theme.accentDim2; case .warn: return Theme.warnLine; case .ghost: return Theme.line } }

    public var body: some View {
        Text(text.uppercased())
            .font(Theme.mono(10))
            .tracking(0.4)
            .foregroundStyle(fg)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(bg)
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

/// A hairline-bordered surface card.
public struct PlotCard<Content: View>: View {
    let accentBorder: Bool
    let content: Content
    public init(accentBorder: Bool = false, @ViewBuilder content: () -> Content) {
        self.accentBorder = accentBorder
        self.content = content()
    }
    public var body: some View {
        content
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(accentBorder ? Theme.accentDim2 : Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.35), radius: 15, y: 12)
    }
}

/// Small uppercase mono section label.
public struct SectionLabel: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text.uppercased()).font(Theme.mono(10)).tracking(1).foregroundStyle(Theme.textFaint)
    }
}
