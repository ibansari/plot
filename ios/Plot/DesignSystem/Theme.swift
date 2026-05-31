import SwiftUI

/// PLOT design tokens — mirrors `plot-mockup (1).html` exactly (dark / premium / minimal-futuristic).
/// Single source of styling truth; web/styles/theme.css carries the same values.
public enum Theme {
    // Backgrounds
    public static let bg = Color(hex: 0x0C0E12)          // canvas
    public static let bg2 = Color(hex: 0x0F1217)
    public static let surface = Color(hex: 0x15181F)
    public static let surface2 = Color(hex: 0x1B1F28)
    public static let surface3 = Color(hex: 0x232833)
    public static let me = Color(hex: 0x15271F)          // my message bubble

    // Lines
    public static let line = Color.white.opacity(0.07)
    public static let line2 = Color.white.opacity(0.12)

    // Text
    public static let text = Color(hex: 0xEAECF1)
    public static let textDim = Color(hex: 0x9AA1AE)
    public static let textFaint = Color(hex: 0x646B79)

    // Accent (mint) + warn (amber) + danger
    public static let accent = Color(hex: 0x5FE6C1)
    public static let accentPress = Color(hex: 0x46CFA9)
    public static let accentInk = Color(hex: 0x04130E)
    public static let accentDim = Color(hex: 0x5FE6C1).opacity(0.13)
    public static let accentDim2 = Color(hex: 0x5FE6C1).opacity(0.22)
    public static let accentGlow = Color(hex: 0x5FE6C1).opacity(0.40)
    public static let warn = Color(hex: 0xF2B25C)
    public static let warnDim = Color(hex: 0xF2B25C).opacity(0.14)
    public static let warnLine = Color(hex: 0xF2B25C).opacity(0.25)
    public static let danger = Color(hex: 0xE5736B)

    // Type — Sora (display), Onest (body), IBM Plex Mono (mono/metadata). System fallback on-weight.
    public static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .custom("Sora", size: size).weight(weight)
    }
    public static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Onest", size: size).weight(weight)
    }
    public static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .custom("IBMPlexMono", size: size).weight(weight)
    }

    /// Deterministic avatar color for a member (matches the mockup's crew palette).
    public static func avatarColor(_ name: String) -> Color {
        switch name.lowercased() {
        case let n where n.hasPrefix("you") || n.hasPrefix("alex"): return accent
        case let n where n.hasPrefix("max"): return Color(hex: 0x7FA6D6)
        case let n where n.hasPrefix("sam"): return Color(hex: 0xD49A78)
        case let n where n.hasPrefix("priya"): return Color(hex: 0xE0C06A)
        case let n where n.hasPrefix("jordan"): return Color(hex: 0x5A6270) // non-user → muted
        case let n where n.hasPrefix("leo"): return Color(hex: 0xE59A93)
        case let n where n.hasPrefix("maya") || n.hasPrefix("dev"): return Color(hex: 0xB69AD6)
        default:
            let palette = [0x7FA6D6, 0xD49A78, 0xE0C06A, 0xB69AD6, 0xE59A93]
            return Color(hex: UInt32(palette[abs(name.hashValue) % palette.count]))
        }
    }
}

public extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}
