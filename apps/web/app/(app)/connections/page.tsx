import type { Provider } from "@devpulse/core";
import { auth } from "@/auth";
import { getConnections } from "@/lib/queries";
import { isOAuthConfigured } from "@/lib/oauth";
import {
  ConnectionsManager,
  type ConnectionView,
} from "@/components/ConnectionsManager";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;

  const rows = await getConnections(userId);
  const connections: ConnectionView[] = rows.map((c) => ({
    id: c.id,
    provider: c.provider,
    authMethod: c.authMethod,
    baseUrl: c.baseUrl,
    externalLogin: c.externalLogin,
    status: c.status,
    statusDetail: c.statusDetail,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
  }));

  const oauthConfigured: Record<Provider, boolean> = {
    GITHUB: isOAuthConfigured("GITHUB"),
    GITLAB: isOAuthConfigured("GITLAB"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Conexões</h1>
        <p className="text-sm text-neutral-500">
          Conecte suas contas para agregar as contribuições no feed unificado.
        </p>
      </div>

      {sp.connected && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Conectado com sucesso ({sp.connected}). A sincronização começou.
        </p>
      )}
      {sp.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Erro: {sp.error}
        </p>
      )}

      <ConnectionsManager
        connections={connections}
        oauthConfigured={oauthConfigured}
      />
    </div>
  );
}
