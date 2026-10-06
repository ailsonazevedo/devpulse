import { providerMeta } from "@/components/labels";
import type { WorkConnection } from "./api";

/** Aviso para conexões OAuth criadas antes da ampliação de escopos. */
export function ReconnectBanner({ connections }: { connections: WorkConnection[] }) {
  const stale = connections.filter((c) => c.missingScopes.length > 0);
  if (stale.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <p>
        Para editar tarefas e mover cards, algumas conexões precisam ser autorizadas de novo
        com permissões de escrita:
      </p>
      <div className="flex flex-wrap gap-2">
        {stale.map((c) => (
          <a
            key={c.id}
            href={`/api/oauth/${c.provider.toLowerCase()}/start`}
            className="btn px-2.5 py-1 text-xs text-white hover:opacity-90"
            style={{ background: providerMeta[c.provider].color }}
            title={`Faltam: ${c.missingScopes.join(", ")}`}
          >
            Reconectar {providerMeta[c.provider].label} · {c.login}
          </a>
        ))}
      </div>
    </div>
  );
}
