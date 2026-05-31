import SwiftUI
import Observation

@MainActor
@Observable
public final class AuthViewModel {
    public var session: Session?
    public var phone: String = "+15550000001" // seed: Maya (organizer)
    public var code: String = ""
    public var devHint: String?
    public var otpSent = false
    public var error: String?
    public var loading = false

    private let api = APIClient.shared

    public init() {}

    public var isAuthed: Bool { session != nil }

    /// Dev convenience: if PLOT_DEV_AUTOLOGIN=<phone> is set, sign in automatically on launch
    /// (used to drive the simulator demo without manual taps). No effect in normal use.
    public func autoLoginIfConfigured() async {
        guard session == nil,
              let phone = ProcessInfo.processInfo.environment["PLOT_DEV_AUTOLOGIN"], !phone.isEmpty
        else { return }
        self.phone = phone
        await startOtp()
        await verifyOtp()
    }

    public func startOtp() async {
        loading = true; error = nil
        do {
            let r = try await api.startOtp(phone: phone)
            otpSent = r.sent
            devHint = r.devHint
            code = r.devHint ?? "" // prefill the dev code for a frictionless demo
        } catch { self.error = "\(error)" }
        loading = false
    }

    public func verifyOtp() async {
        loading = true; error = nil
        do { session = try await api.verifyOtp(phone: phone, code: code) }
        catch { self.error = "\(error)" }
        loading = false
    }

    public func appleToken(_ token: String, _ name: String?) async {
        loading = true; error = nil
        do { session = try await api.signInWithApple(identityToken: token, displayName: name) }
        catch { self.error = "\(error)" }
        loading = false
    }
}
