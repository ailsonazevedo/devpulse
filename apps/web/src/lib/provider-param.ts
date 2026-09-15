import type { Provider } from "@devpulse/core";

/** Converte o segmento de rota (github/gitlab) no enum Provider. */
export function parseProvider(param: string): Provider | null {
  switch (param.toLowerCase()) {
    case "github":
      return "GITHUB";
    case "gitlab":
      return "GITLAB";
    default:
      return null;
  }
}
