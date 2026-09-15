import { z } from "zod";

/**
 * Validação centralizada de env vars usadas pelo core (DB, Redis, cripto).
 * Falha cedo e com mensagem clara se algo estiver faltando.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MASTER_KEY: z.string().min(1),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  MASTER_KEY: process.env.MASTER_KEY,
});

export type CoreEnv = z.infer<typeof schema>;
