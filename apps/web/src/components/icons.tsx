import type { FC } from "react";
import type { ActivityType, Provider } from "@devpulse/core";

type IconProps = { className?: string };

/* ─── Marcas ─────────────────────────────────────────────────────────── */

export function GitHubIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GitLabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.919 1.263a.455.455 0 0 0-.867 0L1.386 9.45.044 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.625-8.443a.924.924 0 0 0 .33-1.024Z" />
    </svg>
  );
}

export function AzureIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M2.4 16.03l6.9-1.2 5.72 6.78a.4.4 0 0 0 .43.13l6.15-2.03V4.5L15.6.3a.4.4 0 0 0-.5.06l-9.9 11.02-2.8-2.15V16Zm12.98-9.2v9.96l-5.13-4.28 5.13-5.68Z" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<Provider, FC<IconProps>> = {
  GITHUB: GitHubIcon,
  GITLAB: GitLabIcon,
  AZURE: AzureIcon,
};

export function ProviderIcon({
  provider,
  className,
}: {
  provider: Provider;
  className?: string;
}) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon className={className} />;
}

/* ─── UI ─────────────────────────────────────────────────────────────── */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M3 12h4l2 6 4-14 2.5 8H21" />
    </svg>
  );
}

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function UnlinkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function LogOutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/* ─── Ícone por tipo de atividade ────────────────────────────────────── */

export function TypeIcon({
  type,
  className,
}: {
  type: ActivityType;
  className?: string;
}) {
  const p = (children: React.ReactNode) => (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...stroke}>
      {children}
    </svg>
  );
  switch (type) {
    case "PUSH":
    case "COMMIT":
      return p(
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M3 12h6M15 12h6" />
        </>,
      );
    case "PR":
      return p(
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M6 9v6" />
          <path d="M13 6h3a2 2 0 0 1 2 2v8" />
        </>,
      );
    case "MR":
      return p(
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M6 9v3a6 6 0 0 0 6 6h3" />
        </>,
      );
    case "ISSUE":
      return p(
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.5" />
        </>,
      );
    case "REVIEW":
      return p(
        <>
          <path d="M22 11.5V12a10 10 0 1 1-5.9-9.1" />
          <path d="m9 11 3 3L22 4" />
        </>,
      );
    case "COMMENT":
      return p(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />);
    case "RELEASE":
      return p(
        <>
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7" cy="7" r="1.2" />
        </>,
      );
    default:
      return p(<path d="M22 12h-4l-3 8L9 4l-3 8H2" />);
  }
}
