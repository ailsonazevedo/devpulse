import type { NextRequest } from "next/server";
import { withWorkConnection } from "@/lib/work";

/** Repositórios/projetos onde o usuário pode criar itens. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.listContainers(creds),
  );
}
