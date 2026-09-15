import Link from "next/link";
import type { ActivityType, Provider } from "@devpulse/core";
import { auth } from "@/auth";
import { getFeed, getStats } from "@/lib/queries";
import { providerMeta, relativeTime, typeLabel } from "@/components/labels";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB"];
const TYPES: ActivityType[] = ["PUSH", "PR", "MR", "ISSUE", "REVIEW", "COMMENT"];

function dayKey(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; type?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;

  const provider = PROVIDERS.includes(sp.provider as Provider)
    ? (sp.provider as Provider)
    : undefined;
  const type = TYPES.includes(sp.type as ActivityType)
    ? (sp.type as ActivityType)
    : undefined;

  const [items, stats] = await Promise.all([
    getFeed(userId, { provider, type }),
    getStats(userId),
  ]);

  // agrupa por dia
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = dayKey(it.occurredAt);
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  const q = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { provider, type, ...patch };
    if (merged.provider) params.set("provider", String(merged.provider));
    if (merged.type) params.set("type", String(merged.type));
    const s = params.toString();
    return s ? `/feed?${s}` : "/feed";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Total" value={stats.total} />
        {PROVIDERS.map((p) => (
          <Stat key={p} label={providerMeta[p].label} value={stats.byProvider[p] ?? 0} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Chip href={q({ provider: undefined })} active={!provider}>
          Todos provedores
        </Chip>
        {PROVIDERS.map((p) => (
          <Chip key={p} href={q({ provider: p })} active={provider === p}>
            {providerMeta[p].label}
          </Chip>
        ))}
        <span className="mx-1 text-neutral-300">|</span>
        <Chip href={q({ type: undefined })} active={!type}>
          Todos tipos
        </Chip>
        {TYPES.map((t) => (
          <Chip key={t} href={q({ type: t })} active={type === t}>
            {typeLabel[t]}
          </Chip>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([day, dayItems]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {day}
              </h2>
              <ul className="flex flex-col gap-1">
                {dayItems.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: providerMeta[it.provider].color }}
                      title={providerMeta[it.provider].label}
                    />
                    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {typeLabel[it.type]}
                    </span>
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate hover:underline"
                    >
                      {it.title}
                    </a>
                    <span className="ml-auto shrink-0 text-xs text-neutral-400">
                      {relativeTime(it.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-full border px-3 py-1 " +
        (active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
          : "border-neutral-300 text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300")
      }
    >
      {children}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
      <p className="text-sm text-neutral-500">
        Nenhuma atividade ainda. Conecte um provedor para começar a sincronizar.
      </p>
      <Link
        href="/connections"
        className="mt-3 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Conectar serviço
      </Link>
    </div>
  );
}
