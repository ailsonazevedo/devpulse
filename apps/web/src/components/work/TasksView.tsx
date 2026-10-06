"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Provider } from "@devpulse/core";
import type { WorkItem } from "@devpulse/core/work";
import { providerMeta, relativeTime } from "@/components/labels";
import { ProviderIcon, RefreshIcon } from "@/components/icons";
import { friendlyError, workFetch, type WorkConnection } from "./api";
import { ReconnectBanner } from "./ReconnectBanner";
import { TaskDrawer } from "./TaskDrawer";
import { NewTaskDialog } from "./NewTaskDialog";
import { Avatars, LabelChips, StateBadge } from "./bits";

export type ListItem = WorkItem & { connectionId: string };

interface ItemsResponse {
  items: ListItem[];
  nextCursor: string | null;
  totals: Record<string, number | null>;
  errors: { connectionId: string; kind: string; message: string }[];
}

export interface TaskFilters {
  provider?: Provider;
  state: "open" | "closed" | "all";
  involvement: "assigned" | "created";
  q: string;
}

function toQuery(f: TaskFilters, cursor?: string | null): string {
  const p = new URLSearchParams();
  if (f.provider) p.set("provider", f.provider);
  if (f.state !== "open") p.set("state", f.state);
  if (f.involvement !== "assigned") p.set("involvement", f.involvement);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export function TasksView({
  connections,
  initial,
}: {
  connections: WorkConnection[];
  initial: TaskFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<TaskFilters>(initial);
  const [search, setSearch] = useState(initial.q);
  const [items, setItems] = useState<ListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [errors, setErrors] = useState<ItemsResponse["errors"]>([]);
  /** Totais da 1ª página (o filtro não muda ao paginar). */
  const [totals, setTotals] = useState<ItemsResponse["totals"]>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [open, setOpen] = useState<ListItem | null>(null);
  const [creating, setCreating] = useState(false);
  /** Descarta respostas de filtros antigos (troca rápida de filtro). */
  const reqId = useRef(0);

  const load = useCallback(async (f: TaskFilters) => {
    const id = ++reqId.current;
    setLoading(true);
    setFatal(null);
    try {
      const res = await workFetch<ItemsResponse>(`/api/work/items?${toQuery(f)}`);
      if (id !== reqId.current) return;
      setItems(res.items);
      setCursor(res.nextCursor);
      setErrors(res.errors);
      setTotals(res.totals);
    } catch (err) {
      if (id === reqId.current) setFatal(friendlyError(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
    const qs = toQuery(filters);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, load, pathname, router]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await workFetch<ItemsResponse>(`/api/work/items?${toQuery(filters, cursor)}`);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
      setErrors(res.errors);
    } catch (err) {
      setFatal(friendlyError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const patch = (p: Partial<TaskFilters>) => setFilters((f) => ({ ...f, ...p }));
  const providers = [...new Set(connections.map((c) => c.provider))];
  const connById = new Map(connections.map((c) => [c.id, c]));

  function onItemChanged(updated: WorkItem, connectionId: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.ref === updated.ref && it.connectionId === connectionId
          ? { ...updated, connectionId }
          : it,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReconnectBanner connections={connections} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip active={!filters.provider} onClick={() => patch({ provider: undefined })}>
            Todos
          </Chip>
          {providers.map((p) => (
            <Chip
              key={p}
              active={filters.provider === p}
              onClick={() => patch({ provider: p })}
            >
              <ProviderIcon provider={p} className="h-3.5 w-3.5" />
              {providerMeta[p].label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={filters.involvement}
            onChange={(v) => patch({ involvement: v })}
            options={[
              { value: "assigned", label: "Atribuídas a mim" },
              { value: "created", label: "Criadas por mim" },
            ]}
          />
          <Segmented
            value={filters.state}
            onChange={(v) => patch({ state: v })}
            options={[
              { value: "open", label: "Abertas" },
              { value: "closed", label: "Fechadas" },
              { value: "all", label: "Todas" },
            ]}
          />
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              patch({ q: search });
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar no título…"
              className="input min-w-0 flex-1 py-1.5"
            />
          </form>
          <button
            onClick={() => void load(filters)}
            className="btn-ghost px-2.5 py-1.5 text-xs"
            title="Recarregar"
          >
            <RefreshIcon className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
          </button>
          <button onClick={() => setCreating(true)} className="btn-primary py-1.5 text-xs">
            Nova tarefa
          </button>
        </div>
      </div>

      {errors.map((e) => {
        const c = connById.get(e.connectionId);
        return (
          <p
            key={e.connectionId}
            className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {c ? `${providerMeta[c.provider].label} · ${c.login}: ` : ""}
            {e.kind === "auth"
              ? "token inválido ou expirado — reconecte em Conexões."
              : e.message}
          </p>
        );
      })}
      {fatal && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {fatal}
        </p>
      )}

      {items.length > 0 && (
        <TotalsBar totals={totals} connections={connections} shown={items.length} />
      )}

      {loading && items.length === 0 ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-sm text-neutral-500">
          Nenhuma tarefa encontrada com esses filtros.
        </div>
      ) : (
        <ul
          className={
            "card divide-y divide-neutral-100 overflow-hidden transition-opacity dark:divide-neutral-800 " +
            (loading ? "opacity-60" : "")
          }
        >
          {items.map((it) => (
            <li key={`${it.connectionId}:${it.ref}`}>
              <button
                onClick={() => setOpen(it)}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: providerMeta[it.provider].color }}
                >
                  <ProviderIcon provider={it.provider} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{it.title}</span>
                    <LabelChips labels={it.labels} max={3} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-400">
                    <span>{it.container.name}</span>
                    <span>{it.number}</span>
                    <span>·</span>
                    <span>{it.kind}</span>
                    <span>·</span>
                    <span>atualizada {relativeTime(new Date(it.updatedAt))}</span>
                  </div>
                </div>
                <Avatars users={it.assignees} />
                <StateBadge state={it.state} raw={it.rawState} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="btn-ghost self-center text-xs"
        >
          {loadingMore ? "Carregando…" : "Carregar mais"}
        </button>
      )}

      {open && (
        <TaskDrawer
          connection={connById.get(open.connectionId)!}
          item={open}
          onClose={() => setOpen(null)}
          onChanged={(u) => onItemChanged(u, open.connectionId)}
        />
      )}
      {creating && (
        <NewTaskDialog
          connections={connections}
          onClose={() => setCreating(false)}
          onCreated={(it, connectionId) => {
            setCreating(false);
            const row = { ...it, connectionId };
            setItems((prev) => [row, ...prev]);
            setOpen(row);
          }}
        />
      )}
    </div>
  );
}

/** "42 tarefas · GitHub 40 · GitLab 2 — mostrando 30". */
function TotalsBar({
  totals,
  connections,
  shown,
}: {
  totals: Record<string, number | null>;
  connections: WorkConnection[];
  shown: number;
}) {
  const byProvider = new Map<Provider, { n: number; partial: boolean }>();
  for (const c of connections) {
    if (!(c.id in totals)) continue;
    const t = totals[c.id];
    const cur = byProvider.get(c.provider) ?? { n: 0, partial: false };
    byProvider.set(c.provider, {
      n: cur.n + (t ?? 0),
      partial: cur.partial || t === null,
    });
  }
  const entries = [...byProvider.entries()];
  const sum = entries.reduce((s, [, v]) => s + v.n, 0);
  const partial = entries.some(([, v]) => v.partial);
  const fmt = (n: number, p: boolean) => `${n.toLocaleString("pt-BR")}${p ? "+" : ""}`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
      <span className="font-semibold text-neutral-700 dark:text-neutral-200">
        {fmt(sum, partial)} {sum === 1 && !partial ? "tarefa" : "tarefas"}
      </span>
      {entries.length > 1 &&
        entries.map(([p, v]) => (
          <span key={p} className="inline-flex items-center gap-1">
            <ProviderIcon provider={p} className="h-3 w-3" />
            {providerMeta[p].label} {fmt(v.n, v.partial)}
          </span>
        ))}
      {shown < sum && <span className="text-neutral-400">· mostrando {shown}</span>}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors " +
        (active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500")
      }
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 text-xs dark:border-neutral-700">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            "rounded-md px-2.5 py-1 font-medium transition-colors " +
            (value === o.value
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <span className="h-7 w-7 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
          </div>
        </li>
      ))}
    </ul>
  );
}
