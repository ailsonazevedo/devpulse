import type { Provider } from "@prisma/client";
import { azureWork } from "./azure.js";
import { githubWork } from "./github.js";
import { gitlabWork } from "./gitlab.js";
import type { WorkAdapter } from "./types.js";

const registry: Record<Provider, WorkAdapter> = {
  GITHUB: githubWork,
  GITLAB: gitlabWork,
  AZURE: azureWork,
};

/** Resolve o adapter de tarefas/boards de um provedor. */
export function getWorkAdapter(provider: Provider): WorkAdapter {
  const adapter = registry[provider];
  if (!adapter) throw new Error(`Gestão de tarefas não implementada: ${provider}`);
  return adapter;
}

export * from "./types.js";
export * from "./errors.js";
export { missingWorkScopes, WORK_SCOPES } from "./scopes.js";
export {
  withConnection,
  ConnectionNotFoundError,
} from "../connection-creds.js";
export { AuthError } from "../adapters/types.js";
