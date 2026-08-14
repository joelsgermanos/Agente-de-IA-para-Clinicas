import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL e obrigatorio"),
  PGSSL: z.coerce.boolean().default(false),

  REDIS_URL: z.string().min(1, "REDIS_URL e obrigatorio"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY e obrigatorio"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o"),
  OPENAI_ROUTER_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_WHISPER_MODEL: z.string().default("whisper-1"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4o-mini"),

  EVOLUTION_API_URL: z.string().min(1),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE_NAME: z.string().min(1),
  EVOLUTION_WEBHOOK_TOKEN: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_REDIRECT_URI: z.string().optional().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  GOOGLE_IMPERSONATE_SUBJECT: z.string().optional().default(""),

  TEAM_WHATSAPP_NUMBERS: z.string().default(""),
  HUMAN_PAUSE_TTL_MINUTES: z.coerce.number().default(60),

  MESSAGE_DEBOUNCE_MS: z.coerce.number().default(4000),

  REMINDER_CRON_INTERVAL_MS: z.coerce.number().default(300000),
  REMINDER_D1_HOUR: z.coerce.number().default(18),
  REMINDER_SAME_DAY_HOURS_BEFORE: z.coerce.number().default(3),

  DEFAULT_CLINIC_NAME: z.string().default("Clinica Exemplo"),
  DEFAULT_CLINIC_ADDRESS: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Variaveis de ambiente invalidas:", parsed.error.flatten().fieldErrors);
  throw new Error("Falha ao carregar configuracao de ambiente");
}

export const env = parsed.data;

export const teamWhatsappNumbers = env.TEAM_WHATSAPP_NUMBERS.split(",")
  .map((n) => n.trim())
  .filter(Boolean);
