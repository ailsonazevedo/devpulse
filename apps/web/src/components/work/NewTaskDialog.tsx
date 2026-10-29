"use client";

import { useEffect, useState } from "react";
import type { BoardColumn, CreateFields, WorkFieldValue, WorkItem } from "@devpulse/core/work";
import { providerMeta } from "@/components/labels";
import { friendlyError, workFetch, type WorkConnection } from "./api";
import { AssigneePicker } from "./AssigneePicker";
import { FieldsEditor, fieldValuesOf, filledFields, type FieldValues } from "./FieldsEditor";
import { LabelPicker } from "./LabelPicker";
import { useContainers, useCreateFields } from "./queries";

/** Board onde a tarefa nasce (criação pela coluna do Kanban). */
export interface BoardTarget {
  id: string;
  name: string;
  columns: Pick<BoardColumn, "id" | "name">[];
  columnId: string;
}

/**
 * Modal de criação: conexão → repositório/projeto → título/descrição, tipo,
 * responsáveis, labels e campos do provedor. Com `board`, cria já no board,
 * na coluna escolhida.
 */
export function NewTaskDialog({
  connections,
  board,
  onClose,
  onCreated,
}: {
  connections: WorkConnection[];
  board?: BoardTarget;
  onClose: () => void;
  onCreated: (item: WorkItem, connectionId: string) => void;
}) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [containerId, setContainerId] = useState("");
  const [columnId, setColumnId] = useState(board?.columnId ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [values, setValues] = useState<FieldValues>({});
  /** No Azure os campos dependem do tipo: escolher outro recarrega o esquema. */
  const [typeParam, setTypeParam] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = connections.find((c) => c.id === connectionId)?.provider;
  const containersQuery = useContainers(connectionId);
  const containers = containersQuery.data ?? (containersQuery.isError ? [] : null);
  const schemaQuery = useCreateFields(connectionId, {
    container: containerId || undefined,
    board: board?.id,
    type: typeParam || undefined,
  });
  const schema: CreateFields | null =
    schemaQuery.data ?? (schemaQuery.isError ? { fields: [], container: null } : null);
  /** repositório/projeto imposto pelo board (GitLab/Azure). */
  const fixedContainer = schemaQuery.data?.container ?? null;
  const queryError = containersQuery.error ?? schemaQuery.error;

  // 1º repositório/projeto da lista como padrão
  useEffect(() => {
    if (!containerId && containersQuery.data?.[0]) setContainerId(containersQuery.data[0].id);
  }, [containerId, containersQuery.data]);

  // board que impõe o projeto: usa o dele
  useEffect(() => {
    if (fixedContainer && fixedContainer.id !== containerId) setContainerId(fixedContainer.id);
  }, [fixedContainer, containerId]);

  // Esquema novo: mantém o que já foi preenchido; o resto vem dos padrões do provedor.
  useEffect(() => {
    const fields = schemaQuery.data?.fields;
    if (!fields) return;
    setValues((prev) => {
      const next = fieldValuesOf(fields);
      for (const f of fields) if (f.id in prev) next[f.id] = prev[f.id]!;
      return next;
    });
  }, [schemaQuery.data]);

  function changeConnection(id: string) {
    setError(null);
    setConnectionId(id);
    setContainerId("");
    setLabels([]);
    setAssignees([]);
    setValues({});
    setTypeParam("");
  }

  function setField(id: string, value: WorkFieldValue) {
    setValues((prev) => ({ ...prev, [id]: value }));
  }

  const typeField = schema?.fields.find((f) => f.id === "type");
  const missing = schema?.fields.filter(
    (f) => f.required && f.id !== "type" && (values[f.id] ?? null) === null,
  );

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
          assignees: assignees.length ? assignees : undefined,
          fields: filledFields(values),
          ...(board ? { boardId: board.id, columnId: columnId || undefined } : {}),
        },
      });
      onCreated(item, connectionId);
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:pt-16">
      <button aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-label="Nova tarefa"
        className="card relative flex w-full max-w-2xl flex-col gap-3 p-5"
      >
        <h2 className="text-base font-semibold">
          Nova tarefa
          {board && <span className="font-normal text-neutral-500"> em {board.name}</span>}
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={connectionId}
            onChange={(e) => changeConnection(e.target.value)}
            disabled={connections.length < 2}
            className="input sm:w-48"
            aria-label="Conta"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {providerMeta[c.provider].label} · {c.login}
              </option>
            ))}
          </select>
          {fixedContainer ? (
            <span className="input min-w-0 flex-1 truncate text-neutral-500" title="Definido pelo board">
              {fixedContainer.name}
            </span>
          ) : (
            <select
              value={containerId}
              onChange={(e) => {
                setContainerId(e.target.value);
                // labels, pessoas e campos são por repositório/projeto
                setLabels([]);
                setAssignees([]);
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
          )}
        </div>

        {(board || typeField) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {board && (
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-500">
                Coluna
                <select
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className="input py-1.5 text-sm font-normal"
                >
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {typeField && (
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-500">
                Tipo
                <select
                  value={values.type === null || values.type === undefined ? "" : String(values.type)}
                  onChange={(e) => {
                    setField("type", e.target.value || null);
                    if (provider === "AZURE") setTypeParam(e.target.value);
                  }}
                  className="input py-1.5 text-sm font-normal"
                >
                  {!typeField.required && <option value="">—</option>}
                  {typeField.options?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

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
          rows={4}
          className="input text-sm"
        />
        <AssigneePicker
          connectionId={connectionId}
          containerId={containerId || null}
          value={assignees}
          onChange={setAssignees}
          single={provider === "AZURE"}
          placeholder="Responsáveis (opcional)"
        />
        <LabelPicker
          connectionId={connectionId}
          containerId={containerId || null}
          value={labels}
          onChange={setLabels}
          placeholder={provider === "AZURE" ? "Tags (opcional)" : "Labels (opcional)"}
        />

        {schema === null && (containerId || board) ? (
          <div className="h-16 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
        ) : (
          schema && (
            <FieldsEditor
              fields={schema.fields}
              values={values}
              onChange={setField}
              skip={["type"]}
            />
          )
        )}

        {(error ?? (queryError ? friendlyError(queryError) : null)) && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error ?? friendlyError(queryError)}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {missing && missing.length > 0 && (
            <span className="mr-auto text-xs text-neutral-400">
              Obrigatório no provedor: {missing.map((f) => f.name).join(", ")}
            </span>
          )}
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
