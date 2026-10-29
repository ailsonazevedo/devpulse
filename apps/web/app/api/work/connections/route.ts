import { NextResponse } from "next/server";
import { getUserId } from "@/lib/api-auth";
import { getWorkConnections } from "@/lib/queries";

/** Conexões utilizáveis em tarefas (sem segredos). Aceita token pessoal. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  return NextResponse.json({ connections: await getWorkConnections(userId) });
}
