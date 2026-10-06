"use client";

import { useEffect, useState } from "react";
import type { WorkContainer, WorkItem } from "@devpulse/core/work";
import { providerMeta } from "@/components/labels";
import { friendlyError, workFetch, type WorkConnection } from "./api";
import { LabelPicker } from "./LabelPicker";

/** Modal de criação: conexão → repositório/projeto → título/descrição/labels. */
export function NewTaskDialog({
  connections,
  onClose,
  onCreated,
}: {
  connections: WorkConnection[];
  onClose: () => void;
  onCreated: (item: WorkItem, connectionId: string) => void;
}) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [containers, setContainers] = useState<WorkContainer[] | null>(null);
  const [containerId, setContainerId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    let alive = true;
    setContainers(null);
    setContainerId("");
    setLabels([]);
    workFetch<WorkContainer[]>(`/api/work/${connectionId}/containers`)
      .then((c) => {
        if (!alive) return;
        setContainers(c);
        setContainerId(c[0]?.id ?? "");
      })
      .catch((e) => {
        if (!alive) return;
        setContainers([]);
        setError(friendlyError(e));
      });
    return () => {
      alive = false;
    };
  }, [connectionId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const item = await workFetch<WorkItem>(`/api/work/${connectionId}/items`, {
        method: "POST",
        body: {
          containerId,
          title,
          body: body || undefined,
          labels,
        },
      });
      onCreated(item, connectionId);
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:pt-24">
      <button aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-label="Nova tarefa"
        className="card relative flex w-full max-w-lg flex-col gap-3 p-5"
      >
        <h2 className="text-base font-semibold">Nova tarefa</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={connectionId}
            onChange={(e) => {
              setError(null);
              setConnectionId(e.target.value);
            }}
            className="input sm:w-48"
            aria-label="Conta"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {providerMeta[c.provider].label} · {c.login}
              </option>
            ))}
          </select>
          <select
            value={containerId}
            onChange={(e) => {
              setContainerId(e.target.value);
              setLabels([]); // labels são por repositório/projeto
            }}
            disabled={!containers || containers.length === 0}
            className="input min-w-0 flex-1"
            aria-label="Repositório ou projeto"
            required
          >
            {containers === null && <option>Carregando…</option>}
            {containers?.length === 0 && <option value="">Nenhum repositório/projeto</option>}
            {containers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título"
          required
          autoFocus
          className="input"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Descrição (opcional)"
          rows={5}
          className="input text-sm"
        />
        <LabelPicker
          connectionId={connectionId}
          containerId={containerId || null}
          value={labels}
          onChange={setLabels}
          placeholder="Labels (opcional)"
        />
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !containerId || !title.trim()}
            className="btn-primary"
          >
            {saving ? "Criando…" : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
