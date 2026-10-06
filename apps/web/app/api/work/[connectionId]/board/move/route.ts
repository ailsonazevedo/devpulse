import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

const MoveBody = z.object({
  boardId: z.string().min(1),
  cardId: z.string().min(1),
  toColumnId: z.string().min(1),
});

/** Move um card para outra coluna do board. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const json = await req.json().catch(() => ({}));
  return withWorkConnection(connectionId, async (adapter, creds) => {
    const { boardId, cardId, toColumnId } = MoveBody.parse(json);
    await adapter.moveCard(creds, boardId, cardId, toColumnId);
  });
}
