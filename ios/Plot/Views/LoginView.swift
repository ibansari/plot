import SwiftUI

struct LoginView: View {
    @Bindable var auth: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            HStack(spacing: 10) { PlotMark(.m); Text("Plot").font(Theme.display(34, .bold)).foregroundStyle(Theme.text) }
            Text("Make the plan. Skip the 200-message thread.")
                .font(Theme.body(15)).foregroundStyle(Theme.textDim)

            PlotCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("PHONE").font(Theme.mono(11)).foregroundStyle(Theme.textDim)
                    TextField("", text: $auth.phone)
                        .font(Theme.mono(16)).foregroundStyle(Theme.text)
                        .keyboardType(.phonePad)
                    if auth.otpSent {
                        Rectangle().fill(Theme.line).frame(height: 1)
                        Text("CODE").font(Theme.mono(11)).foregroundStyle(Theme.textDim)
                        TextField("000000", text: $auth.code)
                            .font(Theme.mono(16)).foregroundStyle(Theme.text)
                            .keyboardType(.numberPad)
                        if let hint = auth.devHint {
                            Text("dev code: \(hint)").font(Theme.mono(11)).foregroundStyle(Theme.accent)
                        }
                    }
                }
                .padding(16)
            }

            Button {
                Task { auth.otpSent ? await auth.verifyOtp() : await auth.startOtp() }
            } label: {
                Text(auth.otpSent ? "Verify & enter" : "Text me a code")
                    .font(Theme.body(15, .semibold)).foregroundStyle(Theme.accentInk)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 12))
            }

            HStack {
                Rectangle().fill(Theme.line).frame(height: 1)
                Text("or").font(Theme.mono(11)).foregroundStyle(Theme.textDim)
                Rectangle().fill(Theme.line).frame(height: 1)
            }

            SignInWithAppleButtonView { token, name in
                Task { await auth.appleToken(token, name) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))

            if let e = auth.error { Text(e).font(Theme.mono(11)).foregroundStyle(Theme.warn) }
            Spacer()
        }
        .padding(24)
    }
}
