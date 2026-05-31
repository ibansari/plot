// Centralized env access. Defaults mirror .env.example so the slice runs with zero real keys.
export const config = {
  port: parseInt(process.env.API_PORT ?? "3000", 10),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:3000",
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3001",
  agentBaseUrl: process.env.AGENT_BASE_URL ?? "http://localhost:8000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  authProvider: process.env.AUTH_PROVIDER ?? "mock",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtTtlSeconds: parseInt(process.env.JWT_TTL_SECONDS ?? "2592000", 10),

  commsProvider: process.env.COMMS_PROVIDER ?? "mock",
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "mock",
  pushProvider: process.env.PUSH_PROVIDER ?? "mock",
  calendarProvider: process.env.CALENDAR_PROVIDER ?? "mock",
  placesProvider: process.env.PLACES_PROVIDER ?? "mock",
  bookingProvider: process.env.BOOKING_PROVIDER ?? "stub",
  mediaStore: process.env.MEDIA_STORE ?? "disk",
  mediaDiskDir: process.env.MEDIA_DISK_DIR ?? "./.media",

  softDeadlineSeconds: parseInt(process.env.PLOT_SOFT_DEADLINE_SECONDS ?? "45", 10),
  linkSigningSecret: process.env.PLOT_LINK_SIGNING_SECRET ?? "dev-link-secret-change-me",
  defaultSpendCapCents: parseInt(process.env.PLOT_DEFAULT_SPEND_CAP_CENTS ?? "5000", 10),

  inngestDev: (process.env.INNGEST_DEV ?? "1") === "1",
};
