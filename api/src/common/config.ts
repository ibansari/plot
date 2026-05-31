// Centralized env access. Defaults mirror .env.example so the slice runs with zero real keys.
export const config = {
  port: parseInt(process.env.API_PORT ?? "3000", 10),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:3000",
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3001",
  agentBaseUrl: process.env.AGENT_BASE_URL ?? "http://localhost:8000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  authProvider: process.env.AUTH_PROVIDER ?? "otp", // otp (real) | stytch (real, hosted) | mock
  stytchProjectId: process.env.STYTCH_PROJECT_ID ?? "",
  stytchSecret: process.env.STYTCH_SECRET ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtTtlSeconds: parseInt(process.env.JWT_TTL_SECONDS ?? "2592000", 10),

  commsProvider: process.env.COMMS_PROVIDER ?? "smtp", // smtp (real, Mailpit) | twilio | mock
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "stripe", // stripe (real SDK→stripe-mock) | mock
  pushProvider: process.env.PUSH_PROVIDER ?? "mock",
  calendarProvider: process.env.CALENDAR_PROVIDER ?? "mock",
  placesProvider: process.env.PLACES_PROVIDER ?? "db",
  bookingProvider: process.env.BOOKING_PROVIDER ?? "reservation",
  mediaStore: process.env.MEDIA_STORE ?? "disk",
  mediaDiskDir: process.env.MEDIA_DISK_DIR ?? "./.media",

  // Stripe (real SDK; STRIPE_API_BASE points at stripe-mock in dev — no paid key)
  stripeApiBase: process.env.STRIPE_API_BASE ?? "http://localhost:12111",
  // SMTP (real protocol; Mailpit in dev)
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "1025", 10),
  smtpFrom: process.env.SMTP_FROM ?? "Plot <plot@plot.local>",

  softDeadlineSeconds: parseInt(process.env.PLOT_SOFT_DEADLINE_SECONDS ?? "45", 10),
  tieBreakSeconds: parseInt(process.env.PLOT_TIEBREAK_SECONDS ?? "120", 10),
  linkSigningSecret: process.env.PLOT_LINK_SIGNING_SECRET ?? "dev-link-secret-change-me",
  defaultSpendCapCents: parseInt(process.env.PLOT_DEFAULT_SPEND_CAP_CENTS ?? "5000", 10),

  // Native Maps (Slice 1): one server-side Google key for Places + Routes. Never shipped raw to
  // clients (the iOS SDK uses its own key). Absent → maps feasibility degrades (status DEGRADED).
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  // AES-256-GCM secret for encrypting private member origins + connector creds at rest (§Privacy).
  // Dev default is NOT secure — set ENCRYPTION_KEY (32+ bytes) in any real environment.
  encryptionKey: process.env.ENCRYPTION_KEY ?? "dev-insecure-encryption-key-change-me!",
  weatherkitToken: process.env.WEATHERKIT_TOKEN ?? "", // Slice 3; absent → weather degrades

  inngestDev: (process.env.INNGEST_DEV ?? "1") === "1",
};
