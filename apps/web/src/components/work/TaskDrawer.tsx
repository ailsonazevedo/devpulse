"use client";

import { useEffect, useState } from "react";
import type { UpdateItemInput, WorkComment, WorkItem, WorkItemDetail } from "@devpulse/core/work";
import { providerMeta, relativeTime } from "@/components/labels";
import { ExternalLinkIcon, ProviderIcon } from "@/components/icons";
import { friendlyError, itemUrl, workFetch, type WorkConnection } from "./api";
import { Avatars, StateBadge } from "./bits";
import { LabelPicker } from "./LabelPicker";

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Painel lateral: detalhe, edição (título/corpo/estado/labels/responsáveis) e comentários. */
export function TaskDrawer({
  connection,
  item,
  onClose,
  onChanged,
}: {
  connection: WorkConnection;
  item: Pick<WorkItem, "ref" | "title" | "provider" | "url" | "number">;
  onClose: () => void;
  onChanged?: (item: WorkItemDetail) => void;
}) {
  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [comments, setComments] = useState<WorkComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState("");
  const [saving, setSaving] = useState(false);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  function fill(d: WorkItemDetail) {
    setDetail(d);
    setTitle(d.title);
    setBody(d.body);
    setState(d.rawState);
    setLabels(d.labels);
    setAssignees(d.assignees.map((a) => a.login).join(", "));
  }

  useEffect(() => {
    let alive = true;
    const url = itemUrl(connection.id, item.ref);
    workFetch<WorkItemDetail>(url)
      .then((d) => alive && fill(d))
      .catch((e) => alive && setError(friendlyError(e)));
    workFetch<WorkComment[]>(itemUrl(connection.id, item.ref, "/comments"))
      .then((c) => alive && setComments(c))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [connection.id, item.ref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Só envia o que mudou (evita sobrescrever edições feitas no provedor). */
  function changes(): UpdateItemInput {
    if (!detail) return {};
    const out: UpdateItemInput = {};
    if (title.trim() !== detail.title) out.title = title.trim();
    if (body !== detail.body) out.body = body;
    if (state !== detail.rawState) out.state = state;
    if (!sameList(labels, detail.labels)) out.labels = labels;
    const a = splitList(assignees);
    if (!sameList(a, detail.assignees.map((x) => x.login))) out.assignees = a;
    return out;
  }

  async function save(patch: UpdateItemInput = changes()) {
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const d = await workFetch<WorkItemDetail>(itemUrl(connection.id, item.ref), {
        method: "PATCH",
        body: patch,
      });
      fill(d);
      onChanged?.(d);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const c = await workFetch<WorkComment>(itemUrl(connection.id, item.ref, "/comments"), {
        method: "POST",
        body: { body: comment },
      });
      setComments((prev) => [...(prev ?? []), c]);
      setComment("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPosting(false);
    }
  }

  const dirty = Object.keys(changes()).length > 0;
  const closedState = detail?.availableStates.find((s) => /^(closed|done)$/i.test(s));
  const openState = detail?.availableStates.find((s) => /^(open|opened|new|active|to do)$/i.test(s));

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside
        role="dialog"
        aria-label={item.title}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
          <ProviderIcon provider={item.provider} className="h-4 w-4" />
          <span className="truncate text-xs text-neutral-500">
            {providerMeta[item.provider].label} · {detail?.container.name ?? ""} {item.number}
          </span>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Abrir no provedor <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-xs">
            Fechar
          </button>
        </header>

        {error && (
          <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {!detail ? (
          !error && <DrawerSkeleton />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input text-base font-semibold"
              aria-label="Título"
            />

            <div className="flex flex-wrap items-center gap-2">
              <StateBadge state={detail.state} raw={detail.rawState} />
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="input py-1 text-xs"
                aria-label="Estado"
              >
                {detail.availableStates.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {detail.state === "open" && closedState && (
                <button
                  onClick={() => void save({ state: closedState })}
                  disabled={saving}
                  className="btn-ghost px-2.5 py-1 text-xs"
                >
                  Fechar item
                </button>
              )}
              {detail.state === "closed" && openState && (
                <button
                  onClick={() => void save({ state: openState })}
                  disabled={saving}
                  className="btn-ghost px-2.5 py-1 text-xs"
                >
                  Reabrir
                </button>
              )}
              <span className="ml-auto text-xs text-neutral-400">
                {detail.kind} · por {detail.author?.name ?? detail.author?.login ?? "?"} ·{" "}
                {relativeTime(new Date(detail.createdAt))}
              </span>
            </div>

            <div className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Labels {detail.provider === "AZURE" && "(tags)"}
              <LabelPicker
                connectionId={connection.id}
                containerId={detail.container.id}
                value={labels}
                onChange={setLabels}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              <span className="flex items-center gap-2">
                Responsáveis
                <Avatars users={detail.assignees} />
              </span>
              <input
                value={assignees}
                onChange={(e) => setAssignees(e.target.value)}
                placeholder={
                  detail.provider === "AZURE"
                    ? "e-mail do responsável (apenas um)"
                    : "logins separados por vírgula"
                }
                className="input font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Descrição
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="input font-mono text-xs font-normal"
              />
              {detail.provider === "AZURE" && (
                <span className="font-normal text-neutral-400">
                  A descrição do Azure é exibida como texto; salvar substitui a formatação original.
                </span>
              )}
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => fill(detail)}
                disabled={!dirty || saving}
                className="btn-ghost text-xs"
              >
                Descartar
              </button>
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="btn-primary text-xs"
              >
                {saving ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>

            <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Comentários {comments ? `· ${comments.length}` : ""}
              </h3>
              {comments === null ? (
                <p className="text-xs text-neutral-400">Carregando…</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-neutral-400">Nenhum comentário.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {comments.map((c) => (
                    <li key={c.id} className="flex gap-2">
                      <Avatars users={c.author ? [c.author] : []} />
                      <div className="min-w-0 flex-1 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
                        <div className="mb-1 text-[11px] text-neutral-400">
                          <span className="font-medium text-neutral-600 dark:text-neutral-300">
                            {c.author?.name ?? c.author?.login ?? "?"}
                          </span>{" "}
                          · {relativeTime(new Date(c.createdAt))}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={postComment} className="flex flex-col gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Escreva um comentário…"
                  className="input text-sm"
                />
                <button
                  type="submit"
                  disabled={posting || !comment.trim()}
                  className="btn-primary self-end text-xs"
                >
                  {posting ? "Enviando…" : "Comentar"}
                </button>
              </form>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="h-9 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-6 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
      <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
    </div>
  );
}
