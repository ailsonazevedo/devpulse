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

/** Enfileira a sincronização de uma conexão. */
export async function enqueueSync(
  connectionId: string,
  mode: SyncJobData["mode"],
): Promise<void> {
  await syncQueue.add(
    `sync:${mode}`,
    { connectionId, mode },
    // dedupe: no máximo 1 job por conexão+modo pendente.
    // jobId não pode conter ":" (restrição do BullMQ) — usar "_".
    { jobId: `${connectionId}_${mode}` },
  );
}
