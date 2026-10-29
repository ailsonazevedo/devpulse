import { NextResponse } from "next/server";
import { getUserId } from "@/lib/api-auth";
import { getAiStats } from "@/lib/queries";

/** Números do AI Pulse (mesmos da página /ai). Aceita token pessoal. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  return NextResponse.json(await getAiStats(userId));
}
