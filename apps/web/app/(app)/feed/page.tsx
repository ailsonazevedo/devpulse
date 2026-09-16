import Link from "next/link";
import type { ActivityType, Provider } from "@devpulse/core";
import { auth } from "@/auth";
import { getConnectedProviders, getFeed, getStats } from "@/lib/queries";
import {
  DISPLAY_TYPES,
  groupMembers,
  groupTypeLabel,
  providerMeta,
  relativeTime,
  typeMeta,
} from "@/components/labels";
import {
  ExternalLinkIcon,
  ProviderIcon,
  TypeIcon,
} from "@/components/icons";

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];
const TYPES: ActivityType[] = DISPLAY_TYPES;
const typeCardLabel = (t: ActivityType) => groupTypeLabel[t] ?? typeMeta[t].label;

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

  const [items, stats, connected] = await Promise.all([
    getFeed(userId, { provider, types: type ? groupMembers(type) : undefined }),
    getStats(userId),
    getConnectedProviders(userId),
  ]);
  // Só mostra cards/chips dos provedores realmente conectados (mantém ordem canônica).
  const shownProviders = PROVIDERS.filter((p) => connected.includes(p));

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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Feed</h1>
        <p className="text-sm text-neutral-500">
          Suas contribuições agregadas em ordem cronológica.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={stats.total} />
        {shownProviders.map((p) => (
          <StatCard
            key={p}
            label={providerMeta[p].label}
            value={stats.byProvider[p] ?? 0}
            provider={p}
          />
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip href={q({ provider: undefined })} active={!provider}>
            Todos
          </Chip>
          {shownProviders.map((p) => (
            <Chip
              key={p}
              href={q({ provider: p })}
              active={provider === p}
              dot={providerMeta[p].color}
            >
              <ProviderIcon provider={p} className="h-3.5 w-3.5" />
              {providerMeta[p].label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip href={q({ type: undefined })} active={!type}>
            Todos tipos
          </Chip>
          {TYPES.map((t) => (
            <Chip key={t} href={q({ type: t })} active={type === t}>
              <TypeIcon type={t} className="h-3.5 w-3.5" />
              {typeCardLabel(t)}
            </Chip>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([day, dayItems]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {day}
                </h2>
                <span className="text-xs text-neutral-400">
                  · {dayItems.length}
                </span>
              </div>
              <ul className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
                {dayItems.map((it) => (
                  <li
                    key={it.id}
                    className="group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  >
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
                        className="flex items-center gap-1.5 truncate font-medium hover:underline"
                      >
                        <span className="truncate">{it.title}</span>
                        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                      <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                        <ProviderIcon
                          provider={it.provider}
                          className="h-3 w-3"
                        />
                        {it.repoName ?? providerMeta[it.provider].label}
                      </div>
                    </div>
                    <time className="shrink-0 text-xs text-neutral-400">
                      {relativeTime(it.occurredAt)}
                    </time>
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

function StatCard({
  label,
  value,
  provider,
}: {
  label: string;
  value: number;
  provider?: Provider;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        {provider && (
          <ProviderIcon provider={provider} className="h-3.5 w-3.5" />
        )}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Chip({
  href,
  active,
  dot,
  children,
}: {
  href: string;
  active: boolean;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors " +
        (active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500")
      }
    >
      {dot && !active && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
      )}
      {children}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <p className="text-sm text-neutral-500">
        Nenhuma atividade ainda. Conecte um provedor para começar a sincronizar.
      </p>
      <Link href="/connections" className="btn-primary">
        Conectar serviço
      </Link>
    </div>
  );
}
