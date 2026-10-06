import type { NextRequest } from "next/server";
import { z } from "zod";
import { withWorkConnection } from "@/lib/work";

/** Labels/tags existentes no repositório/projeto (`container` na query). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const container = req.nextUrl.searchParams.get("container");
  return withWorkConnection(connectionId, (adapter, creds) =>
    adapter.listLabels(
      creds,
      z.string().min(1, "repositório/projeto obrigatório").parse(container ?? ""),
    ),
  );
}
