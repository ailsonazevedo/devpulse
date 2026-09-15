import "dotenv/config";
import { Worker, type Job } from "bullmq";
import {
  SYNC_QUEUE,
  type SyncJobData,
  redis,
  prisma,
  syncConnection,
  syncQueue,
} from "@devpulse/core";

const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY ?? 4);
const INCREMENTAL_EVERY_MIN = Number(process.env.SYNC_INTERVAL_MIN ?? 15);

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

/**
 * Fan-out do tick recorrente: enfileira um sync incremental por conexão ativa.
 */
async function handleTick(): Promise<void> {
  const conns = await prisma.providerConnection.findMany({
    where: { status: { in: ["ACTIVE", "ERROR"] } },
    select: { id: true },
  });
  log("tick:fanout", { count: conns.length });
  await Promise.all(
    conns.map((c) =>
      syncQueue.add(
        "sync:incremental",
        { connectionId: c.id, mode: "incremental" },
        { jobId: `${c.id}_incremental` },
      ),
    ),
  );
}

const worker = new Worker<SyncJobData>(
  SYNC_QUEUE,
  async (job: Job<SyncJobData>) => {
    if (job.name === "tick:incremental") {
      await handleTick();
      return;
    }
    const { connectionId, mode } = job.data;
    log("sync:start", { connectionId, mode, jobId: job.id });
    const result = await syncConnection(connectionId, mode);
    log("sync:done", { connectionId, mode, ...result });
    return result;
  },
  {
    connection: redis,
    concurrency: CONCURRENCY,
    // Limita a vazão global p/ não estourar rate-limit dos provedores.
    limiter: { max: 10, duration: 1000 },
  },
);

worker.on("failed", (job, err) => {
  log("sync:failed", {
    connectionId: job?.data.connectionId,
    attempts: job?.attemptsMade,
    error: err.message,
  });
});

async function main(): Promise<void> {
  // Job repetível: um tick a cada N minutos que faz fan-out das conexões.
  await syncQueue.add(
    "tick:incremental",
    { connectionId: "__tick__", mode: "incremental" },
    { repeat: { every: INCREMENTAL_EVERY_MIN * 60_000 }, jobId: "tick_incremental" },
  );
  log("worker:ready", {
    concurrency: CONCURRENCY,
    intervalMin: INCREMENTAL_EVERY_MIN,
  });
}

main().catch((err) => {
  log("worker:fatal", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log("worker:shutdown", { sig });
    void worker.close().then(() => process.exit(0));
  });
}
