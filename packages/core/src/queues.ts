import { Queue } from "bullmq";
import { redis } from "./redis.js";

export const SYNC_QUEUE = "sync";

/** Dados de um job de sincronização de uma conexão. */
export interface SyncJobData {
  connectionId: string;
  /** backfill = histórico completo; incremental = só o novo desde o cursor. */
  mode: "backfill" | "incremental";
}

export const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/** Estados em que o job ainda vai/está rodando — mantém o dedup. */
const IN_FLIGHT = new Set([
  "waiting",
  "waiting-children",
  "active",
  "delayed",
  "prioritized",
]);

/**
 * Enfileira a sincronização de uma conexão.
 *
 * Dedup: no máximo 1 job por conexão+modo **em andamento**. Como o jobId é fixo
 * e jobs concluídos ficam retidos (removeOnComplete), um novo `add` com o mesmo
 * jobId seria silenciosamente ignorado pelo BullMQ — o que travava resync e o
 * incremental recorrente. Por isso, se já existir um job terminado (completed/
 * failed) com esse id, removemos antes de re-enfileirar.
 */
export async function enqueueSync(
  connectionId: string,
  mode: SyncJobData["mode"],
): Promise<void> {
  // jobId não pode conter ":" (restrição do BullMQ) — usar "_".
  const jobId = `${connectionId}_${mode}`;
  const existing = await syncQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (IN_FLIGHT.has(state)) return; // já há um pendente/ativo: dedup
    await existing.remove(); // terminado e retido: libera o jobId
  }
  await syncQueue.add(`sync:${mode}`, { connectionId, mode }, { jobId });
}
