"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@devpulse/core";
import { providerMeta } from "@/components/labels";
import {
  ProviderIcon,
  RefreshIcon,
  UnlinkIcon,
} from "@/components/icons";

export interface ConnectionView {
  id: string;
  provider: Provider;
  authMethod: "OAUTH" | "PAT";
  baseUrl: string | null;
  externalLogin: string;
  status: string;
  statusDetail: string | null;
  lastSyncedAt: string | null;
}

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB", "AZURE"];

export function ConnectionsManager({
  connections,
  oauthConfigured,
}: {
  connections: ConnectionView[];
  oauthConfigured: Record<Provider, boolean>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(id: string) {
    if (!confirm("Desconectar? As atividades dessa conexão serão removidas."))
      return;
    setBusy(id);
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  async function resync(id: string) {
    setBusy(id);
    await fetch(`/api/connections/${id}/resync`, { method: "POST" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          Suas conexões
        </h2>
        {connections.length === 0 ? (
          <div className="card border-dashed p-6 text-center text-sm text-neutral-400">
            Nenhuma conexão ainda. Conecte um provedor abaixo.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="card flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: providerMeta[c.provider].color }}
                >
                  <ProviderIcon provider={c.provider} className="h-5 w-5" />
                </span>
                <div className="mr-auto min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">
                      {providerMeta[c.provider].label} · {c.externalLogin}
                    </span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800">
                      {c.authMethod}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-400">
                    {c.baseUrl && (
                      <>
                        <span className="truncate">{c.baseUrl}</span>
                        <span>·</span>
                      </>
                    )}
                    <StatusBadge status={c.status} detail={c.statusDetail} />
                    <span>·</span>
                    <span>
                      {c.lastSyncedAt
                        ? `sync ${new Date(c.lastSyncedAt).toLocaleString("pt-BR")}`
                        : "nunca sincronizado"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => resync(c.id)}
                  disabled={busy === c.id}
                  className="btn-ghost px-2.5 py-1.5 text-xs"
                >
                  <RefreshIcon
                    className={"h-3.5 w-3.5 " + (busy === c.id ? "animate-spin" : "")}
                  />
                  Ressincronizar
                </button>
                <button
                  onClick={() => disconnect(c.id)}
                  disabled={busy === c.id}
                  className="btn px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <UnlinkIcon className="h-3.5 w-3.5" />
                  Desconectar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          Conectar via OAuth
        </h2>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <a
              key={p}
              href={
                oauthConfigured[p] ? `/api/oauth/${p.toLowerCase()}/start` : undefined
              }
              aria-disabled={!oauthConfigured[p]}
              className={
                "btn px-4 py-2 text-white shadow-sm " +
                (oauthConfigured[p]
                  ? "hover:opacity-90"
                  : "cursor-not-allowed opacity-40")
              }
              style={{ background: providerMeta[p].color }}
              title={
                oauthConfigured[p]
                  ? ""
                  : "OAuth não configurado (defina CLIENT_ID/SECRET no .env)"
              }
            >
              <ProviderIcon provider={p} className="h-4 w-4" />
              Conectar {providerMeta[p].label}
            </a>
          ))}
        </div>
      </section>

      <PatForm onError={setError} onDone={() => router.refresh()} />
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  detail,
}: {
  status: string;
  detail: string | null;
}) {
  const map: Record<string, string> = {
    ACTIVE: "bg-green-500",
    SYNCING: "bg-blue-500",
    ERROR: "bg-red-500",
    REVOKED: "bg-red-500",
  };
  return (
    <span className="inline-flex items-center gap-1" title={detail ?? ""}>
      <span
        className={"h-1.5 w-1.5 rounded-full " + (map[status] ?? "bg-neutral-400")}
      />
      {status.toLowerCase()}
    </span>
  );
}

function PatForm({
  onError,
  onDone,
}: {
  onError: (m: string | null) => void;
  onDone: () => void;
}) {
  const [provider, setProvider] = useState<Provider>("GITHUB");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setLoading(true);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, token, baseUrl: baseUrl || undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? "Falha ao conectar");
      return;
    }
    setToken("");
    setBaseUrl("");
    onDone();
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-neutral-500">
        Conectar via Personal Access Token
      </h2>
      <p className="mb-3 text-xs text-neutral-400">
        Funciona também para instâncias self-hosted (informe a base URL).
      </p>
      <form onSubmit={submit} className="card flex flex-col gap-3 p-4 sm:max-w-xl">
        <div className="flex gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500">
              <ProviderIcon provider={provider} className="h-4 w-4" />
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="input appearance-none pl-8 pr-8"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {providerMeta[p].label}
                </option>
              ))}
            </select>
          </div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            required
            placeholder="Personal Access Token"
            className="input flex-1"
          />
        </div>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          type="url"
          required={provider === "AZURE"}
          placeholder={
            provider === "AZURE"
              ? "URL da organização (obrigatória, ex.: https://dev.azure.com/sua-org)"
              : "Base URL self-hosted (opcional, ex.: https://gitlab.suaempresa.com)"
          }
          className="input"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-400">
            Escopos mínimos: GitHub <code>read:user, repo</code> · GitLab{" "}
            <code>read_user, read_api</code> · Azure DevOps{" "}
            <code>Code (read), Work Items (read)</code>.
          </p>
          <button type="submit" disabled={loading} className="btn-primary shrink-0">
            {loading ? "Validando…" : "Conectar"}
          </button>
        </div>
      </form>
    </section>
  );
}
