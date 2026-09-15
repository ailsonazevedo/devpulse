"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@devpulse/core";
import { providerMeta } from "@/components/labels";

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

const PROVIDERS: Provider[] = ["GITHUB", "GITLAB"];

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
    if (!confirm("Desconectar? As atividades dessa conexão serão removidas.")) return;
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
          <p className="text-sm text-neutral-400">Nenhuma conexão ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800"
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: providerMeta[c.provider].color }}
                />
                <div className="mr-auto">
                  <div className="text-sm font-medium">
                    {providerMeta[c.provider].label} · {c.externalLogin}
                    <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                      {c.authMethod}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400">
                    {c.baseUrl ? c.baseUrl + " · " : ""}
                    <StatusBadge status={c.status} detail={c.statusDetail} />
                    {c.lastSyncedAt
                      ? ` · sync ${new Date(c.lastSyncedAt).toLocaleString("pt-BR")}`
                      : " · nunca sincronizado"}
                  </div>
                </div>
                <button
                  onClick={() => resync(c.id)}
                  disabled={busy === c.id}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
                >
                  Ressincronizar
                </button>
                <button
                  onClick={() => disconnect(c.id)}
                  disabled={busy === c.id}
                  className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
                >
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
                oauthConfigured[p]
                  ? `/api/oauth/${p.toLowerCase()}/start`
                  : undefined
              }
              aria-disabled={!oauthConfigured[p]}
              className={
                "rounded-md px-4 py-2 text-sm font-medium text-white " +
                (oauthConfigured[p]
                  ? "hover:opacity-90"
                  : "cursor-not-allowed opacity-40")
              }
              style={{ background: providerMeta[p].color }}
              title={
                oauthConfigured[p]
                  ? ""
                  : "OAuth não configurado (defina CLIENT_ID/SECRET)"
              }
            >
              Conectar {providerMeta[p].label}
            </a>
          ))}
        </div>
      </section>

      <PatForm
        onError={setError}
        onDone={() => router.refresh()}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
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
  const color =
    status === "ACTIVE"
      ? "text-green-600"
      : status === "SYNCING"
        ? "text-blue-500"
        : "text-red-500";
  return (
    <span className={color} title={detail ?? ""}>
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
      <h2 className="mb-3 text-sm font-semibold text-neutral-500">
        Conectar via Personal Access Token (inclui self-hosted)
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:max-w-lg">
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {providerMeta[p].label}
              </option>
            ))}
          </select>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            required
            placeholder="Personal Access Token"
            className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
        </div>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          type="url"
          placeholder="Base URL self-hosted (opcional, ex.: https://gitlab.minhaempresa.com)"
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "Validando…" : "Conectar"}
        </button>
        <p className="text-xs text-neutral-400">
          Escopos mínimos: GitHub <code>read:user, repo</code> · GitLab{" "}
          <code>read_user, read_api</code>. O token é cifrado em repouso e nunca
          é exibido novamente.
        </p>
      </form>
    </section>
  );
}
