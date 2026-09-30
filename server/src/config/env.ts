import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1).default("postgresql://mobius:mobius@127.0.0.1:5432/mobius_ems"),
  POSTGRES_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(20).default(2),
  POSTGRES_MAX_POOL_SIZE: z.coerce.number().int().min(2).max(100).default(5),
  POSTGRES_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DEFAULT_TENANT_NAME: z.string().min(2).max(120).default("MobiusEMS"),
  DEFAULT_TENANT_SLUG: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).default("mobiusbloom"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  PLATFORM_OWNER_NAME: z.string().min(2).max(120).optional(),
  PLATFORM_OWNER_EMAIL: z.string().email().optional(),
  PLATFORM_OWNER_PASSWORD: z.string().min(12).max(128).optional(),
  JWT_ACCESS_SECRET: z.string().min(32), JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"), JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  COOKIE_DOMAIN: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(), CLOUDINARY_API_KEY: z.string().optional(), CLOUDINARY_API_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().positive().optional(), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  BREVO_API_KEY: z.string().min(20).optional(), BREVO_SENDER_EMAIL: z.string().email().optional(), BREVO_SENDER_NAME: z.string().min(1).max(100).default("MobiusEMS"),
  BREVO_REPLY_TO_EMAIL: z.string().email().optional(), BREVO_WEBHOOK_TOKEN: z.string().min(24).optional(),
  INTEGRATION_ENCRYPTION_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  EMAIL_AUTOMATION_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  EMAIL_AUTOMATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  EMAIL_AUTOMATION_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(250),
  AI_PROVIDER: z.enum(["groq", "openai", "openrouter", "together", "anthropic", "gemini", "generic"]).default("groq"),
  AI_API_KEY: z.string().optional(), GROQ_API_KEY: z.string().optional(), OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(), GEMINI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(), AI_MODEL: z.string().optional(), AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
  AI_COMPANY_KNOWLEDGE: z.string().max(20_000).optional(),
  VOICE_PYTHON_COMMAND: z.string().min(1).default("python"),
  VOICE_WHISPER_MODEL: z.string().min(1).default("small"),
  VOICE_WHISPER_DEVICE: z.enum(["cpu", "cuda", "auto"]).default("cpu"),
  VOICE_WHISPER_COMPUTE_TYPE: z.string().min(1).default("int8"),
  VOICE_WHISPER_LANGUAGE: z.string().max(10).optional(),
  VOICE_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),
  SUPER_ADMIN_NAME: z.string().optional(), SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
  WHALEXY_DEMO_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WHALEXY_DEMO_PASSWORD: z.string().min(16).max(128).optional(),
  ATTENDANCE_OFFICE_NAME: z.string().default("Shivnath Business Centre, Raipur"),
  ATTENDANCE_OFFICE_LATITUDE: z.coerce.number().min(-90).max(90).default(21.251413450117614),
  ATTENDANCE_OFFICE_LONGITUDE: z.coerce.number().min(-180).max(180).default(81.70943785263866),
  ATTENDANCE_RADIUS_METERS: z.coerce.number().int().min(50).max(5000).default(300),
  ATTENDANCE_MAX_ACCURACY_METERS: z.coerce.number().int().min(10).max(1000).default(200)
});

const result = schema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
export const env = result.data;

