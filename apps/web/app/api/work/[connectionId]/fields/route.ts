import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

const Query = z
  .object({
    container: z.string().min(1).optional(),
    board: z.string().min(1).optional(),
    type: z.string().min(1).max(100).optional(),
  })
  .refine((q) => q.container || q.board, "informe o repositório/projeto ou o board");

/** Campos disponíveis na criação (tipo, prioridade, esforço…), por container e/ou board. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  return withWorkConnection(connectionId, (adapter, creds) => {
    const q = Query.parse({
      container: sp.get("container") || undefined,
      board: sp.get("board") || undefined,
      type: sp.get("type") || undefined,
    });
    return adapter.getCreateFields(creds, {
      containerId: q.container,
      boardId: q.board,
      type: q.type,
    });
  });
}
