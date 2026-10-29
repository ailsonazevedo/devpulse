import { prisma, type Provider } from "@devpulse/core";
import { auth } from "@/auth";
import { getConnections } from "@/lib/queries";
import { isOAuthConfigured } from "@/lib/oauth";
import { missingWorkScopes } from "@devpulse/core/work";
import {
  ConnectionsManager,
  type ConnectionView,
} from "@/components/ConnectionsManager";
import { ApiTokensCard } from "@/components/ApiTokensCard";
import { env } from "@/env";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const sp = await searchParams;

  const [rows, apiTokens] = await Promise.all([
    getConnections(userId),
    prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    }),
  ]);
  const connections: ConnectionView[] = rows.map((c) => ({
    id: c.id,
    provider: c.provider,
    authMethod: c.authMethod,
    baseUrl: c.baseUrl,
    externalLogin: c.externalLogin,
    status: c.status,
    statusDetail: c.statusDetail,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
    missingScopes:
      c.status === "REVOKED" ? [] : missingWorkScopes(c.provider, c.authMethod, c.scopes),
  }));

  const oauthConfigured: Record<Provider, boolean> = {
    GITHUB: isOAuthConfigured("GITHUB"),
    GITLAB: isOAuthConfigured("GITLAB"),
    AZURE: isOAuthConfigured("AZURE"),
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

      <section className="card p-5">
        <ApiTokensCard
          initialTokens={apiTokens.map((t) => ({
            ...t,
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
          }))}
          baseUrl={env.AUTH_URL.replace(/\/$/, "")}
        />
      </section>
    </div>
  );
}
