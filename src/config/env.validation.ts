import { PLATFORM_NAME } from "@/common/platform-name";
import { z } from "zod";

// Fails startup fast and loudly if a required env var is missing or malformed,
// instead of letting the app boot into a half-configured state.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default("m300.events"),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),

  CORS_ORIGIN: z.string().optional(),

  // Optional, not required at boot: without it, emails are logged instead of
  // sent (see EmailService) rather than crashing the whole app over a
  // missing third-party key in local dev. Webhook signing needs no env var
  // of its own - each subscription gets its own HMAC secret at creation.
  RESEND_API_KEY: z.string().optional(),
  // raven-emrc.com, not the frontend's m300.energymrc.ng - confirmed live
  // against the Resend dashboard that only raven-emrc.com (and an
  // unrelated koraerp.com) are verified sending domains on this account.
  // m300.energymrc.ng is the frontend's own domain (CORS_ORIGIN/
  // FRONTEND_URL) and was never verified for sending - every send to it
  // failed with a 403 from Resend until this changed.
  EMAIL_FROM: z.string().default(`${PLATFORM_NAME} <notifications@raven-emrc.com>`),

  // Base URL of the frontend - used only to build set-password/reset-password
  // links in emails (e.g. `${FRONTEND_URL}/account/set-password?token=...`),
  // and to resolve the DEFAULT logo (/Logos/geapp.png, a frontend static
  // asset) for the email header - see notifications/email/templates/layout.ts.
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  // Base URL of THIS API, as reachable from the public internet (not
  // 127.0.0.1) - frontend and backend are two separate origins (Vercel +
  // its own VPS, see README.md), so this can't be derived from FRONTEND_URL.
  // Used only to resolve an admin-uploaded logo for email, since
  // GET /branding/logo/:filename is a backend route, not a frontend asset -
  // see notifications/email/templates/layout.ts.
  BACKEND_URL: z.string().default("http://localhost:3000"),

  // First-boot only: if the users table is empty, one SYSTEM_ADMINISTRATOR
  // is created from these two values (see bootstrap-admin.service.ts) so an
  // invite-only system has someone able to invite anyone else. Optional -
  // without them, an empty DB just stays empty until seeded another way.
  // `.or(z.literal(""))` matters: an env file with the key present but no
  // value (e.g. `BOOTSTRAP_ADMIN_EMAIL=`) sets process.env to "", not
  // undefined - plain `.optional()` rejects that "", so a blank-but-present
  // line would crash startup instead of being treated as "not set".
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional().or(z.literal("")),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
