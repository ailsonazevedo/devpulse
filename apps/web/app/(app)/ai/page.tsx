import Link from "next/link";
import { auth } from "@/auth";
import { getAiStats } from "@/lib/queries";
import {
  aiSignalLabel,
  aiToolLabel,
  providerMeta,
  relativeTime,
  typeMeta,
} from "@/components/labels";
import { ProviderIcon, TypeIcon } from "@/components/icons";
import { AiBadge } from "@/components/AiBadge";

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function AiPulsePage() {
  const session = await auth();
  const userId = session!.user.id;
  const stats = await getAiStats(userId);

  const share = pct(stats.ai, stats.total);
  const top = stats.byTool[0];
  const maxTool = Math.max(1, ...stats.byTool.map((t) => t.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI Pulse</h1>
        <p className="text-sm text-neutral-500">
          Quanto das suas entregas de código (commits, pushes e PRs) teve
          participação de IA, em todos os provedores.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Entregas com IA" value={`${share}%`} hint={`${stats.ai} de ${stats.total}`} />
        <Tile label="Atividades com IA" value={String(stats.ai)} />
        <Tile
          label="Ferramenta principal"
          value={top ? (aiToolLabel[top.tool] ?? top.tool) : "—"}
          hint={top ? `${pct(top.count, stats.ai)}% das detecções` : undefined}
        />
      </div>

      {stats.ai === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="card p-5">
            <h2 className="text-sm font-semibold">
              % de entregas com IA por semana
            </h2>
            <p className="mb-4 text-xs text-neutral-500">Últimas 12 semanas</p>
            <WeeklyChart weeks={stats.weeks} />
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold">Por ferramenta</h2>
            <ul className="flex flex-col gap-3">
              {stats.byTool.map((t) => (
                <li key={t.tool} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-neutral-600 dark:text-neutral-300">
                    {aiToolLabel[t.tool] ?? t.tool}
                  </span>
                  <span className="h-3 rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <span
                      className="block h-3 rounded-full bg-violet-500 dark:bg-violet-400"
                      style={{ width: `${(t.count / maxTool) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-neutral-500">{t.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Detecções recentes
            </h2>
            <ul className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
              {stats.recent.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 " +
                      typeMeta[it.type].tint
                    }
                  >
                    <TypeIcon type={it.type} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium hover:underline"
                    >
                      {it.title}
                    </a>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                      <ProviderIcon provider={it.provider} className="h-3 w-3" />
                      {it.repoName ?? providerMeta[it.provider].label}
                      {it.aiSignal && <> · via {aiSignalLabel[it.aiSignal] ?? it.aiSignal}</>}
                    </div>
                  </div>
                  <AiBadge tool={it.aiTool!} />
                  <time className="shrink-0 text-xs text-neutral-400">
                    {relativeTime(it.occurredAt)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="text-xs text-neutral-400">
        Detectamos IA por trailers de commit (<code>Co-Authored-By</code>,{" "}
        <code>Generated-by</code>), rodapés como “Generated with Claude Code”,
        contas bot de agentes e branches como <code>claude/…</code> ou{" "}
        <code>copilot/…</code>. Atividades antigas são reanalisadas ao fazer
        Resync de uma conexão.
      </p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

/** Colunas de % semanal (uma série, uma cor); tooltip nativo por coluna. */
function WeeklyChart({ weeks }: { weeks: { week: string; total: number; ai: number }[] }) {
  return (
    <div>
      <div className="flex h-40 items-end gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {weeks.map((w) => {
          const p = pct(w.ai, w.total);
          const tip = `Semana de ${weekLabel(w.week)}: ${p}% (${w.ai} de ${w.total})`;
          return (
            <div
              key={w.week}
              title={tip}
              aria-label={tip}
              className="group flex h-full flex-1 flex-col justify-end rounded-t hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
            >
              <span className="mb-1 text-center text-[10px] tabular-nums text-neutral-500 opacity-0 group-hover:opacity-100">
                {p}%
              </span>
              <span
                className="mx-auto block w-full max-w-6 rounded-t bg-violet-500 dark:bg-violet-400"
                style={{ height: `${p}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-neutral-400">
        {weeks.map((w, i) => (
          <span key={w.week} className="flex-1 text-center">
            {i % 3 === 0 ? weekLabel(w.week) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <p className="max-w-md text-sm text-neutral-500">
        Nenhuma atividade com IA detectada ainda. Commits com trailer{" "}
        <code>Co-Authored-By: Claude</code> ou PRs de branches de agentes
        aparecerão aqui. Já tem histórico? Faça Resync nas conexões para
        reanalisar.
      </p>
      <Link href="/connections" className="btn-ghost">
        Ir para conexões
      </Link>
    </div>
  );
}
