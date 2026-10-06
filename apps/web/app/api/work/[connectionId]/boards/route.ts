import type { NextRequest } from "next/server";
import { withWorkConnection } from "@/lib/work";

/** Boards visíveis na conexão (Projects v2, Issue Boards, Azure Boards). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.listBoards(creds),
  );
}
