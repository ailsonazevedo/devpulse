"use client";

import { useEffect, useMemo, useState } from "react";
import type { Provider } from "@devpulse/core";
import { providerMeta } from "@/components/labels";
import { DownloadIcon, ProviderIcon } from "@/components/icons";

type Theme = "auto" | "light" | "dark";
type ColorBy = "level" | "provider";

const THEMES: { value: Theme; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];
const COLORS: { value: ColorBy; label: string }[] = [
  { value: "level", label: "Nível" },
  { value: "provider", label: "Provedor" },
];

/** Escala do PNG: 2x fica nítido em telas retina e slides. */
const PNG_SCALE = 2;

/** Dispara o download de um blob no navegador. */
function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Rasteriza o SVG num canvas (fundo e fontes já vêm no próprio SVG). */
async function svgToPng(svg: string): Promise<Blob> {
  const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * PNG_SCALE;
    canvas.height = img.naturalHeight * PNG_SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(PNG_SCALE, PNG_SCALE);
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * Configura o link público do heatmap (SVG) para colar no README do perfil do
 * GitHub ou em qualquer lugar que aceite imagem por URL.
 */
export function EmbedCard({
  initialToken,
  baseUrl,
  providers,
}: {
  initialToken: string | null;
  baseUrl: string;
  /** Provedores conectados (ordem de exibição). */
  providers: Provider[];
}) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("auto");
  const [colorBy, setColorBy] = useState<ColorBy>("level");
  const [header, setHeader] = useState(true);
  const [selected, setSelected] = useState<Set<Provider>>(new Set(providers));
  const [copied, setCopied] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"png" | "svg" | null>(null);
  // cache-buster só da prévia (a URL publicada fica estável). Gerado após
  // montar: Date.now() no render difere entre SSR e cliente (hydration mismatch).
  const [nonce, setNonce] = useState<number | null>(null);
  useEffect(() => setNonce(Date.now()), []);

  const url = useMemo(() => {
    if (!token) return null;
    const params = new URLSearchParams();
    if (theme !== "auto") params.set("theme", theme);
    if (colorBy !== "level") params.set("color", colorBy);
    if (!header) params.set("header", "0");
    if (selected.size < providers.length) {
      params.set(
        "providers",
        providers.filter((p) => selected.has(p)).map((p) => p.toLowerCase()).join(","),
      );
    }
    const qs = params.toString();
    return `${baseUrl}/api/embed/heatmap/${token}.svg${qs ? `?${qs}` : ""}`;
  }, [token, theme, colorBy, header, selected, providers, baseUrl]);

  const markdown = url ? `![Heatmap de contribuições (DevPulse)](${url})` : "";
  const html = url ? `<img src="${url}" alt="Heatmap de contribuições (DevPulse)" />` : "";

  async function act(action: "enable" | "regenerate" | "disable") {
    if (
      action !== "enable" &&
      !window.confirm(
        action === "disable"
          ? "Desativar o link? Imagens já publicadas deixarão de carregar."
          : "Gerar um novo link? O link atual deixará de funcionar.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { token: string | null };
      setToken(data.token);
    } catch {
      setError("Não foi possível atualizar o link. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  /**
   * Baixa a imagem com as opções atuais. No tema "Automático" o arquivo fixa o
   * tema do sistema agora (uma imagem baixada não acompanha o modo escuro).
   */
  async function download(format: "png" | "svg") {
    if (!url) return;
    setDownloading(format);
    setError(null);
    try {
      const resolved =
        theme === "auto"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme;
      const u = new URL(url);
      u.searchParams.set("theme", resolved);
      // Caminho relativo: same-origin mesmo se o app for aberto por outro host.
      const res = await fetch(u.pathname + u.search, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const svg = await res.text();
      const name = `devpulse-heatmap-${new Date().toISOString().slice(0, 10)}.${format}`;
      saveBlob(
        format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg),
        name,
      );
    } catch {
      setError("Não foi possível gerar a imagem. Tente novamente.");
    } finally {
      setDownloading(null);
    }
  }

  const toggle = (p: Provider) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next.size === 0 ? new Set(providers) : next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">Incorporar no perfil</h2>
        <p className="text-sm text-neutral-500">
          Uma imagem do heatmap somando todos os provedores, atualizada
          automaticamente — cole no README do seu perfil do GitHub.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!token ? (
        <div>
          <button className="btn-primary" disabled={busy} onClick={() => act("enable")}>
            Ativar link público
          </button>
          <p className="mt-2 text-xs text-neutral-400">
            Quem tiver o link verá apenas o calendário de contribuições — nenhum
            repositório, título ou detalhe de atividade.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
            <Segmented label="Tema" options={THEMES} value={theme} onChange={setTheme} />
            <Segmented label="Cor" options={COLORS} value={colorBy} onChange={setColorBy} />
            <label className="inline-flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={header}
                onChange={(e) => setHeader(e.target.checked)}
              />
              Cabeçalho
            </label>
            {providers.length > 1 && (
              <div className="flex items-center gap-1.5">
                {providers.map((p) => {
                  const on = selected.has(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggle(p)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition " +
                        (on
                          ? "border-neutral-300 dark:border-neutral-600"
                          : "border-neutral-200 text-neutral-400 opacity-60 dark:border-neutral-800")
                      }
                      style={on ? { color: providerMeta[p].color } : undefined}
                    >
                      <ProviderIcon provider={p} className="h-3.5 w-3.5" />
                      {providerMeta[p].label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-dashed border-neutral-200 p-3 dark:border-neutral-800">
            {nonce === null ? (
              <div className="h-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${url}${url!.includes("?") ? "&" : "?"}v=${nonce}`}
                alt="Prévia do heatmap"
                className="max-w-none"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-neutral-500">Baixar</span>
            <button
              className="btn-ghost"
              disabled={downloading !== null}
              onClick={() => download("png")}
            >
              <DownloadIcon className="h-4 w-4" />
              {downloading === "png" ? "Gerando…" : "PNG"}
            </button>
            <button
              className="btn-ghost"
              disabled={downloading !== null}
              onClick={() => download("svg")}
            >
              <DownloadIcon className="h-4 w-4" />
              {downloading === "svg" ? "Gerando…" : "SVG"}
            </button>
            {theme === "auto" && (
              <span className="text-xs text-neutral-400">
                no tema atual do sistema
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <CopyField label="Markdown" value={markdown} copied={copied === "md"} onCopy={() => copy("md", markdown)} />
            <CopyField label="HTML" value={html} copied={copied === "html"} onCopy={() => copy("html", html)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => act("regenerate")}>
              Gerar novo link
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => act("disable")}>
              Desativar
            </button>
            <p className="text-xs text-neutral-400">
              A imagem é atualizada algumas vezes ao dia (cache de até 4h).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-neutral-500">{label}</span>
      <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              "rounded-md px-2.5 py-1 font-medium transition-colors " +
              (value === o.value
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
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
      <span className="w-20 shrink-0 text-xs text-neutral-500">{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} className="input min-w-0 flex-1 font-mono text-xs" />
      <button className="btn-ghost shrink-0" onClick={onCopy}>
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
