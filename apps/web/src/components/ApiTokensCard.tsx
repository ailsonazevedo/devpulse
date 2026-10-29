"use client";

import { useState } from "react";
import { relativeTime } from "@/components/labels";

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * Tokens pessoais de API (Bearer) — usados pelo MCP do Claude Code para ler e
 * gerenciar tarefas. O valor em claro aparece uma única vez, ao criar.
 */
export function ApiTokensCard({
  initialTokens,
  baseUrl,
}: {
  initialTokens: ApiTokenView[];
  baseUrl: string;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("Claude Code");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const command = `claude mcp add devpulse -e DEVPULSE_URL=${baseUrl} -e DEVPULSE_TOKEN=${created ?? "<seu-token>"} -- node <caminho-do-devpulse>/apps/mcp/dist/index.js`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível criar o token.");
      const { token, apiToken } = json as { token: string; apiToken: ApiTokenView };
      setCreated(token);
      setTokens((prev) => [apiToken, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revogar o token? Clientes que o usam perdem o acesso na hora.")) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Não foi possível revogar o token.");
      return;
    }
    setTokens((prev) => prev.filter((t) => t.id !== id));
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">Claude Code (MCP)</h2>
        <p className="text-sm text-neutral-500">
          Gere um token pessoal para o Claude Code listar, criar e atualizar
          tarefas, mover cards e consultar sua atividade. O token não dá acesso
          às conexões nem aos segredos dos provedores.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={create} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Nome do token"
          className="input min-w-0 flex-1"
        />
        <button className="btn-primary" disabled={busy || !name.trim()}>
          Gerar token
        </button>
      </form>

      {created && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Copie agora — este token não será exibido novamente.
          </p>
          <CopyField label="Token" value={created} copied={copied === "token"} onCopy={() => copy("token", created)} />
          <CopyField label="Comando" value={command} copied={copied === "cmd"} onCopy={() => copy("cmd", command)} />
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{t.name}</span>{" "}
                <code className="text-xs text-neutral-400">{t.prefix}…</code>
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {t.lastUsedAt ? `usado ${relativeTime(new Date(t.lastUsedAt))}` : "nunca usado"}
              </span>
              <button className="btn-ghost shrink-0" onClick={() => revoke(t.id)}>
                Revogar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-500">{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} className="input min-w-0 flex-1 font-mono text-xs" />
      <button type="button" className="btn-ghost shrink-0" onClick={onCopy}>
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
