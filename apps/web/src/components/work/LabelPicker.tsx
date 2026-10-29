"use client";

import { useId, useRef, useState } from "react";
import type { WorkLabel } from "@devpulse/core/work";
import { useLabels } from "./queries";

/**
 * Seleção de labels com busca entre as existentes no repositório/projeto.
 * Também aceita uma label nova digitada (GitHub/GitLab criam ao salvar; no
 * Azure tags são livres).
 */
export function LabelPicker({
  connectionId,
  containerId,
  value,
  onChange,
  placeholder = "Adicionar label…",
}: {
  connectionId: string;
  containerId: string | null;
  value: string[];
  onChange: (labels: string[]) => void;
  placeholder?: string;
}) {
  const labelsQuery = useLabels(connectionId, containerId);
  const available = labelsQuery.data ?? (labelsQuery.isError ? [] : null);
  const failed = labelsQuery.isError;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byName = new Map((available ?? []).map((l) => [l.name.toLowerCase(), l]));
  const q = query.trim();
  const selected = new Set(value.map((v) => v.toLowerCase()));
  const matches = (available ?? []).filter(
    (l) => !selected.has(l.name.toLowerCase()) && l.name.toLowerCase().includes(q.toLowerCase()),
  );
  const canCreate = q !== "" && !byName.has(q.toLowerCase()) && !selected.has(q.toLowerCase());
  const options: { name: string; label?: WorkLabel; create?: boolean }[] = [
    ...matches.slice(0, 50).map((l) => ({ name: l.name, label: l })),
    ...(canCreate ? [{ name: q, create: true }] : []),
  ];

  function add(name: string) {
    // Usa a grafia existente (labels são case-insensitive na busca).
    const canonical = byName.get(name.toLowerCase())?.name ?? name;
    onChange([...value, canonical]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" || e.key === ",") {
      const opt = options[active];
      if (opt || q) {
        e.preventDefault();
        add(opt?.name ?? q);
      }
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      remove(value[value.length - 1]!);
    } else if (e.key === "Escape" && open) {
      // Fecha só a lista, sem fechar o painel/modal em volta.
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="input flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5 py-1.5 font-normal"
      >
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 py-0.5 pl-2 pr-1 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            <Dot color={byName.get(name.toLowerCase())?.color} />
            {name}
            <button
              type="button"
              aria-label={`Remover ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(name);
              }}
              className="rounded-full px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
        />
      </div>

      {open && containerId && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {available === null ? (
            <li className="px-3 py-2 text-xs text-neutral-400">Carregando labels…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">
              {failed
                ? "Não foi possível carregar as labels — digite para adicionar."
                : available.length === 0
                  ? "Nenhuma label no projeto — digite para criar."
                  : "Nenhuma outra label."}
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={(o.create ? "+" : "") + o.name}
                role="option"
                aria-selected={i === active}
                // mousedown (não click): roda antes do blur fechar a lista
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o.name);
                }}
                onMouseEnter={() => setActive(i)}
                className={
                  "flex cursor-pointer items-center gap-2 px-3 py-1.5 " +
                  (i === active ? "bg-neutral-100 dark:bg-neutral-800" : "")
                }
              >
                {o.create ? (
                  <span className="text-neutral-500">
                    Criar <strong className="text-neutral-800 dark:text-neutral-100">“{o.name}”</strong>
                  </span>
                ) : (
                  <>
                    <Dot color={o.label?.color} />
                    <span className="truncate">{o.name}</span>
                    {o.label?.description && (
                      <span className="ml-auto truncate text-xs text-neutral-400">
                        {o.label.description}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Dot({ color }: { color?: string | null }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 dark:border-white/10"
      style={{ background: color ?? "transparent" }}
    />
  );
}
