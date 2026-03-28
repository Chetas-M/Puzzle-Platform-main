import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(12),
  COOKIE_NAME: z.string().min(1).default("team_session"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5174"),
  MAX_WARNINGS: z.coerce.number().int().positive().default(3),
  LEADERBOARD_CACHE_TTL_MS: z.coerce.number().int().min(0).default(3000),
  EVENT_STARTS_AT: z.string().datetime().optional(),
  EVENT_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),
  NODE_ENV: z.string().optional()
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production"
};
