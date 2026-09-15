import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * Conexão Redis compartilhada. BullMQ exige maxRetriesPerRequest: null.
 */
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis: Redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
