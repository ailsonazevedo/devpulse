import type { Provider } from "@prisma/client";
import { azureAdapter } from "./azure.js";
import { githubAdapter } from "./github.js";
import { gitlabAdapter } from "./gitlab.js";
import type { ProviderAdapter } from "./types.js";

const registry: Record<Provider, ProviderAdapter> = {
  GITHUB: githubAdapter,
  GITLAB: gitlabAdapter,
  AZURE: azureAdapter,
};

/** Resolve o adapter de um provedor. Adicionar Bitbucket/Gitea = novo item aqui. */
export function getAdapter(provider: Provider): ProviderAdapter {
  const adapter = registry[provider];
  if (!adapter) throw new Error(`Adapter não implementado: ${provider}`);
  return adapter;
}

export * from "./types.js";
