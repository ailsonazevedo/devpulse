import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

/** Colunas e cards de um board (id na query: pode conter "/"). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const id = req.nextUrl.searchParams.get("id");
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.getBoard(creds, z.string().min(1, "board obrigatório").parse(id)),
  );
}
