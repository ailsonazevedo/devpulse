"use client";

import { useId, useRef, useState } from "react";
import type { WorkUser } from "@devpulse/core/work";
import { useAssignees } from "./queries";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Seleção de responsáveis entre as pessoas atribuíveis do repositório/projeto
 * (busca por nome ou login). `single` limita a um (Azure DevOps).
 */
export function AssigneePicker({
  connectionId,
  containerId,
  value,
  onChange,
  single = false,
  known = [],
  placeholder = "Adicionar responsável…",
}: {
  connectionId: string;
  containerId: string | null;
  /** logins selecionados. */
  value: string[];
  onChange: (logins: string[]) => void;
  single?: boolean;
  /** usuários já conhecidos (ex.: responsáveis atuais), para exibir nome/avatar. */
  known?: WorkUser[];
  placeholder?: string;
}) {
  const assigneesQuery = useAssignees(connectionId, containerId);
  const available = assigneesQuery.data ?? (assigneesQuery.isError ? [] : null);
  const failed = assigneesQuery.isError;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byLogin = new Map(
    [...known, ...(available ?? [])].map((u) => [u.login.toLowerCase(), u]),
  );
  const selected = new Set(value.map((v) => v.toLowerCase()));
  const q = norm(query.trim());
  const options = (available ?? [])
    .filter(
      (u) =>
        !selected.has(u.login.toLowerCase()) &&
        (norm(u.login).includes(q) || norm(u.name ?? "").includes(q)),
    )
    .slice(0, 50);

  function add(login: string) {
    onChange(single ? [login] : [...value, login]);
    setQuery("");
    setActive(0);
    if (single) setOpen(false);
    else inputRef.current?.focus();
  }

  function remove(login: string) {
    onChange(value.filter((v) => v !== login));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const opt = options[active];
      if (opt) {
        e.preventDefault();
        add(opt.login);
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
        {value.map((login) => {
          const u = byLogin.get(login.toLowerCase());
          return (
            <span
              key={login}
              title={login}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 py-0.5 pl-0.5 pr-1 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
            >
              <UserAvatar user={u ?? { login }} />
              {u?.name ?? login}
              <button
                type="button"
                aria-label={`Remover ${login}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(login);
                }}
                className="rounded-full px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </span>
          );
        })}
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
          placeholder={value.length === 0 ? placeholder : single ? "Trocar…" : ""}
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
            <li className="px-3 py-2 text-xs text-neutral-400">Carregando pessoas…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">
              {failed
                ? "Não foi possível carregar as pessoas do projeto."
                : q
                  ? "Ninguém encontrado."
                  : "Nenhuma outra pessoa."}
            </li>
          ) : (
            options.map((u, i) => (
              <li
                key={u.login}
                role="option"
                aria-selected={i === active}
                // mousedown (não click): roda antes do blur fechar a lista
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(u.login);
                }}
                onMouseEnter={() => setActive(i)}
                className={
                  "flex cursor-pointer items-center gap-2 px-3 py-1.5 " +
                  (i === active ? "bg-neutral-100 dark:bg-neutral-800" : "")
                }
              >
                <UserAvatar user={u} />
                <span className="truncate">{u.name ?? u.login}</span>
                {u.name && (
                  <span className="ml-auto truncate text-xs text-neutral-400">{u.login}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function UserAvatar({ user }: { user: WorkUser }) {
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
      {(user.name ?? user.login).slice(0, 1)}
    </span>
  );
}
