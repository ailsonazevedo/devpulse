import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@devpulse/core";
import { auth } from "@/auth";

/** Prefixo dos tokens pessoais; facilita reconhecer um token vazado. */
export const API_TOKEN_PREFIX = "dp_";

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Gera um token novo. Só o hash e o prefixo vão para o banco. */
export function generateApiToken(): { token: string; tokenHash: string; prefix: string } {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashApiToken(token), prefix: token.slice(0, 10) };
}

/**
 * Usuário da requisição: `Authorization: Bearer dp_…` (token pessoal, usado
 * pelo MCP do Claude Code) ou, sem header, a sessão do navegador.
 * Um Bearer inválido NÃO cai para a sessão — responde como não autenticado.
 *
 * Use só em rotas liberadas para tokens (tarefas e leitura de atividade);
 * conexões/OAuth continuam exigindo a sessão via `auth()`.
 */
export async function getUserId(): Promise<string | null> {
  const header = (await headers()).get("authorization");
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const token = match?.[1];
    if (!token?.startsWith(API_TOKEN_PREFIX)) return null;
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash: hashApiToken(token) },
      select: { id: true, userId: true },
    });
    if (!row) return null;
    // fire-and-forget: não atrasa a requisição
    prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return row.userId;
  }
  const session = await auth();
  return session?.user?.id ?? null;
}
