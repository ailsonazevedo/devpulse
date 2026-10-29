import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import type { Credentials } from "../adapters/types.js";

/**
 * Cache de METADADOS das telas de tarefas (labels, pessoas, campos, tipos,
 * iterações, repositórios, configuração de boards…) no Redis, por conexão.
 * Itens e cards são sempre ao vivo — não passam por aqui.
 *
 * É best-effort: Redis fora do ar ou lento só faz cair direto no provedor.
 */

/** TTLs em segundos, pela frequência com que cada coisa muda. */
export const TTL = {
  /** listas que mudam com uso normal (labels novas, repos, boards). */
  short: 5 * 60,
  /** pessoas, milestones, iterações, repositórios Git. */
  medium: 15 * 60,
  /** definições de processo (tipos, campos, estados). */
  long: 60 * 60,
} as const;

const PREFIX = "dp:work:v1";

/**
 * Conexão própria, que falha rápido: a compartilhada (BullMQ) usa
 * `maxRetriesPerRequest: null` e ficaria pendurada com o Redis fora do ar.
 */
const g = globalThis as unknown as { workCacheRedis?: Redis };
function client(): Redis {
  // REDIS_URL direto (não `env`): importar este módulo não exige o resto do .env.
  g.workCacheRedis ??= new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 250,
    connectTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  const c = g.workCacheRedis;
  // erros de conexão são esperados no modo best-effort
  if (c.listenerCount("error") === 0) c.on("error", () => {});
  if (c.status === "wait") c.connect().catch(() => {});
  return c;
}

/** Partes da chave podem conter "/", "#", espaços… — hash longo, mantém curto. */
function part(s: string): string {
  return s.length <= 80 && /^[\w.\-/:@#]+$/.test(s)
    ? s
    : createHash("sha256").update(s).digest("base64url").slice(0, 22);
}

function keyOf(scope: string, parts: string[]): string {
  return [PREFIX, scope, ...parts.map(part)].join(":");
}

/** Leituras simultâneas da mesma chave viram uma só ida ao provedor. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Valor em cache (por conexão) ou carregado com `load` e gravado por `ttl`
 * segundos. `creds.fresh` ignora o cache na leitura.
 */
export async function cached<T>(
  creds: Credentials,
  parts: string[],
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const scope = creds.cacheScope;
  if (!scope) return load();
  const key = keyOf(scope, parts);

  if (!creds.fresh) {
    try {
      const hit = await client().get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      // sem cache: segue para o provedor
    }
  }

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    const value = await load();
    try {
      await client().set(key, JSON.stringify(value), "EX", ttl);
    } catch {
      // best-effort
    }
    return value;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** Remove chaves (após mutações que mudam metadados, ex.: label nova). */
export async function invalidate(creds: Credentials, ...keys: string[][]): Promise<void> {
  const scope = creds.cacheScope;
  if (!scope || keys.length === 0) return;
  try {
    await client().del(...keys.map((k) => keyOf(scope, k)));
  } catch {
    // best-effort: expira pelo TTL
  }
}

/** Remove todo o cache de uma conexão (ex.: ao desconectar/reconectar). */
export async function clearConnectionCache(connectionId: string): Promise<void> {
  try {
    const c = client();
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", `${PREFIX}:${connectionId}:*`, "COUNT", 200);
      if (keys.length) await c.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } catch {
    // best-effort
  }
}
