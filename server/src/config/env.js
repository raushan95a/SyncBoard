import { z } from 'zod';

const emptyToUndefined = (v) => (v === '' ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGO_URI must be a mongodb:// or mongodb+srv:// URI'),
  MONGO_DB: z.string().min(1).default('collabboard-dev'),
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REDIS_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/**
 * Validates configuration and fails fast (docs/06). Values come from process.env only;
 * `npm run dev` loads server/.env via `node --env-file-if-exists`.
 * @param {Record<string, string | undefined>} source
 */
export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee server/.env.example.`);
  }
  return Object.freeze(parsed.data);
}

export const env = loadEnv();
