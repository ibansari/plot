import SwiftUI
import AuthenticationServices

/// Sign in with Apple button that hands the identity token to the API (dev mock ignores the value
/// and returns a canned identity, so this works in the simulator with no Apple Developer setup).
public struct SignInWithAppleButtonView: View {
    let onToken: (String, String?) -> Void

    public init(onToken: @escaping (String, String?) -> Void) {
        self.onToken = onToken
    }

    public var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName]
        } onCompletion: { result in
            switch result {
            case .success(let auth):
                if let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                   let tokenData = cred.identityToken,
                   let token = String(data: tokenData, encoding: .utf8) {
                    let name = [cred.fullName?.givenName, cred.fullName?.familyName]
                        .compactMap { $0 }.joined(separator: " ")
                    onToken(token, name.isEmpty ? nil : name)
                } else {
                    // dev simulator may not return a token; the mock backend accepts any string
                    onToken("dev-mock-apple-token", nil)
                }
            case .failure:
                break
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: 50)
    }
}
