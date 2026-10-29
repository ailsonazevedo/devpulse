"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  UpdateItemInput,
  WorkComment,
  WorkItem,
  WorkItemDetail,
  WorkLink,
} from "@devpulse/core/work";
import { providerMeta, relativeTime } from "@/components/labels";
import { ExternalLinkIcon, ProviderIcon } from "@/components/icons";
import { friendlyError, itemUrl, workFetch, type WorkConnection } from "./api";
import { Avatars, StateBadge } from "./bits";
import { LabelPicker } from "./LabelPicker";
import { AssigneePicker } from "./AssigneePicker";
import { FieldsEditor, changedFields, fieldValuesOf, type FieldValues } from "./FieldsEditor";
import { buildClaudeCommand, slugify } from "./claude";
import { invalidateLists, useComments, useTaskDetail, workKeys } from "./queries";

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Painel lateral: detalhe, edição (título/corpo/estado/labels/responsáveis/campos), branches e comentários. */
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
  const qc = useQueryClient();
  const detailQuery = useTaskDetail(connection.id, item.ref);
  const commentsQuery = useComments(connection.id, item.ref);
  const comments = commentsQuery.data ?? (commentsQuery.isError ? [] : null);
  /** Base do formulário: o último detalhe aplicado (não muda sob edição em curso). */
  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [fieldVals, setFieldVals] = useState<FieldValues>({});
  const [saving, setSaving] = useState(false);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  function fill(d: WorkItemDetail) {
    setDetail(d);
    setTitle(d.title);
    setBody(d.body);
    setState(d.rawState);
    setLabels(d.labels);
    setAssignees(d.assignees.map((a) => a.login));
    setFieldVals(fieldValuesOf(d.fields));
  }

  // Cache aparece na hora; a revalidação só reaplica se não houver edição em curso.
  useEffect(() => {
    if (detailQuery.data && !dirtyRef.current) fill(detailQuery.data);
  }, [detailQuery.data]);

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
    if (!sameList(assignees, detail.assignees.map((x) => x.login))) out.assignees = assignees;
    const f = changedFields(detail.fields, fieldVals);
    if (Object.keys(f).length > 0) out.fields = f;
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
      qc.setQueryData(workKeys.item(connection.id, item.ref), d);
      dirtyRef.current = false;
      fill(d);
      onChanged?.(d);
      invalidateLists(qc, connection.id);
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
      qc.setQueryData<WorkComment[]>(workKeys.comments(connection.id, item.ref), (prev) => [
        ...(prev ?? []),
        c,
      ]);
      setComment("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPosting(false);
    }
  }

  async function copyClaudeCommand() {
    try {
      await navigator.clipboard.writeText(buildClaudeCommand(connection.id, item));
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2500);
    } catch {
      setError("Não foi possível copiar o comando.");
    }
  }

  const dirty = Object.keys(changes()).length > 0;
  dirtyRef.current = dirty;
  const loadError = !detail && detailQuery.error ? friendlyError(detailQuery.error) : null;
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
          <button
            onClick={() => void copyClaudeCommand()}
            title="Copia um comando para colar no terminal do repositório (requer o MCP devpulse)"
            className="btn-ghost px-2 py-1 text-xs"
          >
            {copiedCmd ? "Copiado — cole no terminal" : "Iniciar no Claude Code"}
          </button>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-xs">
            Fechar
          </button>
        </header>

        {(error ?? loadError) && (
          <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error ?? loadError}
          </p>
        )}

        {!detail ? (
          !loadError && <DrawerSkeleton />
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
            <div className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              {detail.provider === "AZURE" ? "Responsável" : "Responsáveis"}
              <AssigneePicker
                connectionId={connection.id}
                containerId={detail.container.id}
                value={assignees}
                onChange={setAssignees}
                single={detail.provider === "AZURE"}
                known={detail.assignees}
              />
            </div>
            <FieldsEditor
              fields={detail.fields}
              values={fieldVals}
              onChange={(id, v) => setFieldVals((prev) => ({ ...prev, [id]: v }))}
              disabled={saving}
            />
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

            <DevelopmentSection
              connectionId={connection.id}
              detail={detail}
              onCreated={(link) => {
                const add = (d?: WorkItemDetail) => (d ? { ...d, links: [...d.links, link] } : d);
                setDetail((d) => add(d ?? undefined) ?? null);
                qc.setQueryData<WorkItemDetail>(workKeys.item(connection.id, item.ref), add);
              }}
            />

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

/** Nome sugerido: `<número>-<slug>` (o GitLab liga à issue as branches com esse prefixo). */
export function suggestBranch(item: Pick<WorkItem, "number" | "title">): string {
  const n = item.number.replace(/[^0-9]/g, "");
  return [n, slugify(item.title)].filter(Boolean).join("-") || "task";
}

/** Branches e PRs/MRs vinculados + criação de branch a partir da principal. */
function DevelopmentSection({
  connectionId,
  detail,
  onCreated,
}: {
  connectionId: string;
  detail: WorkItemDetail;
  onCreated: (link: WorkLink) => void;
}) {
  const repos = detail.branchRepositories;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(() => suggestBranch(detail));
  const [repo, setRepo] = useState(
    () => repos?.find((r) => r.name === detail.container.name)?.id ?? repos?.[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await workFetch<WorkLink>(itemUrl(connectionId, detail.ref, "/branch"), {
        method: "POST",
        body: { name: name.trim(), repositoryId: repo || undefined },
      });
      onCreated(link);
      setCreating(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Desenvolvimento
        </h3>
        {!creating && (repos === null || repos.length > 0) && (
          <button onClick={() => setCreating(true)} className="btn-ghost px-2 py-1 text-xs">
            Criar branch
          </button>
        )}
      </div>
      {detail.links.length === 0 && !creating && (
        <p className="text-xs text-neutral-400">Nenhuma branch ou PR vinculado.</p>
      )}
      {detail.links.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {detail.links.map((l, i) => (
            <li key={`${l.kind}:${l.name}:${i}`} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-neutral-400">
                {l.kind === "branch" ? "branch" : detail.provider === "GITLAB" ? "MR" : "PR"}
              </span>
              {l.url ? (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate font-mono text-xs hover:underline"
                >
                  {l.name}
                </a>
              ) : (
                <span className="min-w-0 truncate font-mono text-xs">{l.name}</span>
              )}
              {l.state && <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{l.state}</span>}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <form onSubmit={create} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            {repos && repos.length > 1 && (
              <select
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="input py-1.5 text-sm sm:w-48"
                aria-label="Repositório"
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input min-w-0 flex-1 py-1.5 font-mono text-xs"
              aria-label="Nome da branch"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-neutral-400">
              A partir da branch principal, vinculada a esta tarefa.
            </span>
            <button type="button" onClick={() => setCreating(false)} className="btn-ghost px-2 py-1 text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy || !name.trim()} className="btn-primary px-2.5 py-1 text-xs">
              {busy ? "Criando…" : "Criar branch"}
            </button>
          </div>
        </form>
      )}
    </section>
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
