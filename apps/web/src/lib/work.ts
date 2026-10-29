import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import {
  AuthError,
  ConnectionNotFoundError,
  ScopeError,
  WorkInputError,
  WorkNotFoundError,
  getWorkAdapter,
  withConnection,
  type WorkAdapter,
} from "@devpulse/core/work";
import type { Credentials } from "@devpulse/core";
import { headers } from "next/headers";
import { getUserId } from "@/lib/api-auth";

/** Valores de campos (`WorkField.id` → valor); null limpa. */
export const FieldValues = z
  .record(z.string().min(1).max(300), z.union([z.string().max(2000), z.number(), z.null()]))
  .refine((r) => Object.keys(r).length <= 60, "campos demais");

/** Categoria do erro devolvida ao client (decide a mensagem/ação na UI). */
export type WorkErrorKind = "auth" | "scope" | "not_found" | "input" | "provider";

export function classifyWorkError(err: unknown): {
  status: number;
  kind: WorkErrorKind;
  message: string;
} {
  const message = err instanceof Error ? err.message : "erro desconhecido";
  if (err instanceof ConnectionNotFoundError || err instanceof WorkNotFoundError) {
    return { status: 404, kind: "not_found", message };
  }
  if (err instanceof AuthError) return { status: 401, kind: "auth", message };
  if (err instanceof ScopeError) return { status: 403, kind: "scope", message };
  if (err instanceof WorkInputError) return { status: 400, kind: "input", message };
  if (err instanceof ZodError) {
    return { status: 400, kind: "input", message: err.issues[0]?.message ?? "entrada inválida" };
  }
  console.error("[work]", err);
  return { status: 502, kind: "provider", message };
}

function errorResponse(err: unknown) {
  const { status, kind, message } = classifyWorkError(err);
  return NextResponse.json({ error: message, kind }, { status });
}

/** Header do client para ignorar o cache de metadados (botão "Recarregar"). */
export const REFRESH_HEADER = "x-devpulse-refresh";

/**
 * Rota que opera numa conexão do usuário (sessão ou token pessoal), resolve o
 * adapter, executa com credenciais válidas (refresh automático) e converte
 * erros de domínio em status HTTP.
 */
export async function withWorkConnection(
  connectionId: string,
  fn: (adapter: WorkAdapter, creds: Credentials) => Promise<unknown>,
) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  try {
    const fresh = (await headers()).get(REFRESH_HEADER) === "1";
    const result = await withConnection(connectionId, userId, (creds, conn) =>
      fn(getWorkAdapter(conn.provider), fresh ? { ...creds, fresh } : creds),
    );
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
