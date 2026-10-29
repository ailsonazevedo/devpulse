import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DevPulseError, errorHint, type DevPulseClient } from "./client.js";

const enc = encodeURIComponent;
const work = (connectionId: string, path: string) => `/api/work/${enc(connectionId)}${path}`;

const connectionId = z
  .string()
  .min(1)
  .describe("id da conexão no DevPulse (veja list_connections ou o campo connectionId de list_tasks)");
const ref = z
  .string()
  .min(1)
  .describe("ref da tarefa: GitHub `owner/repo#123`, GitLab `projectId#iid`, Azure `projeto#id`");

/** Resposta em JSON indentado; erros viram `isError` com dica acionável. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
  } catch (err) {
    const text = err instanceof DevPulseError ? errorHint(err) : String(err);
    return { content: [{ type: "text", text }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

export function registerTools(server: McpServer, api: DevPulseClient): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexões",
      description:
        "Contas de provedores (GitHub, GitLab, Azure DevOps) conectadas ao DevPulse. Use o `id` como connectionId nas outras ferramentas.",
      annotations: READ,
    },
    () => run(() => api.request("/api/work/connections")),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "Listar tarefas",
      description:
        "Lista unificada de issues/work items do usuário em todos os provedores, ordenada pela última atualização. Erros por conexão voltam em `errors` sem derrubar os demais.",
      inputSchema: {
        state: z.enum(["open", "closed", "all"]).default("open"),
        involvement: z
          .enum(["assigned", "created"])
          .default("assigned")
          .describe("assigned = atribuídas a mim; created = criadas por mim"),
        q: z.string().max(200).optional().describe("busca por texto"),
        provider: z.enum(["GITHUB", "GITLAB", "AZURE"]).optional(),
        connectionId: connectionId.optional(),
        cursor: z.string().optional().describe("nextCursor da página anterior"),
      },
      annotations: READ,
    },
    (args) => run(() => api.request("/api/work/items", { query: args })),
  );

  server.registerTool(
    "get_task",
    {
      title: "Ler tarefa",
      description:
        "Detalhe de uma tarefa (corpo, labels, responsáveis, estados aceitos em `availableStates`) e seus comentários.",
      inputSchema: { connectionId, ref },
      annotations: READ,
    },
    ({ connectionId, ref }) =>
      run(async () => {
        const [item, comments] = await Promise.all([
          api.request(work(connectionId, "/item"), { query: { ref } }),
          api.request(work(connectionId, "/item/comments"), { query: { ref } }),
        ]);
        return { ...(item as object), comments };
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Criar tarefa",
      description:
        "Cria uma issue/work item num repositório ou projeto. Use list_containers para descobrir o containerId.",
      inputSchema: {
        connectionId,
        containerId: z.string().min(1).describe("id do repositório/projeto (list_containers)"),
        title: z.string().min(1).max(256),
        body: z.string().max(65_000).optional().describe("markdown"),
        labels: z.array(z.string().min(1)).max(20).optional(),
      },
      annotations: WRITE,
    },
    ({ connectionId, ...body }) =>
      run(() => api.request(work(connectionId, "/items"), { method: "POST", body })),
  );

  server.registerTool(
    "update_task",
    {
      title: "Atualizar tarefa",
      description:
        "Edita título, corpo, estado (um dos `availableStates` de get_task), labels e/ou responsáveis. Envie só o que muda; labels/assignees substituem a lista inteira.",
      inputSchema: {
        connectionId,
        ref,
        title: z.string().min(1).max(256).optional(),
        body: z.string().max(65_000).optional(),
        state: z.string().min(1).optional(),
        labels: z.array(z.string().min(1)).max(50).optional(),
        assignees: z
          .array(z.string().min(1))
          .max(10)
          .optional()
          .describe("logins (GitHub/GitLab) ou e-mail (Azure, só o primeiro)"),
      },
      annotations: WRITE,
    },
    ({ connectionId, ref, ...body }) =>
      run(() =>
        api.request(work(connectionId, "/item"), { method: "PATCH", query: { ref }, body }),
      ),
  );

  server.registerTool(
    "comment_task",
    {
      title: "Comentar tarefa",
      description: "Adiciona um comentário (markdown) na tarefa, visível no provedor.",
      inputSchema: { connectionId, ref, body: z.string().min(1).max(65_000) },
      annotations: WRITE,
    },
    ({ connectionId, ref, body }) =>
      run(() =>
        api.request(work(connectionId, "/item/comments"), {
          method: "POST",
          query: { ref },
          body: { body },
        }),
      ),
  );

  server.registerTool(
    "list_containers",
    {
      title: "Listar repositórios/projetos",
      description: "Repositórios (GitHub) ou projetos (GitLab/Azure) onde o usuário pode criar tarefas.",
      inputSchema: { connectionId },
      annotations: READ,
    },
    ({ connectionId }) => run(() => api.request(work(connectionId, "/containers"))),
  );

  server.registerTool(
    "list_labels",
    {
      title: "Listar labels",
      description: "Labels (tags no Azure) existentes num repositório/projeto.",
      inputSchema: { connectionId, containerId: z.string().min(1) },
      annotations: READ,
    },
    ({ connectionId, containerId }) =>
      run(() => api.request(work(connectionId, "/labels"), { query: { container: containerId } })),
  );

  server.registerTool(
    "list_boards",
    {
      title: "Listar boards",
      description: "Boards visíveis na conexão (GitHub Projects v2, GitLab Issue Boards, Azure Boards).",
      inputSchema: { connectionId },
      annotations: READ,
    },
    ({ connectionId }) => run(() => api.request(work(connectionId, "/boards"))),
  );

  server.registerTool(
    "get_board",
    {
      title: "Ler board",
      description:
        "Colunas e cards de um board. Cada card tem `id` (para move_card) e `ref` (a tarefa por trás, null = rascunho).",
      inputSchema: { connectionId, boardId: z.string().min(1) },
      annotations: READ,
    },
    ({ connectionId, boardId }) =>
      run(() => api.request(work(connectionId, "/board"), { query: { id: boardId } })),
  );

  server.registerTool(
    "move_card",
    {
      title: "Mover card",
      description: "Move um card para outra coluna do board (ids vindos de get_board).",
      inputSchema: {
        connectionId,
        boardId: z.string().min(1),
        cardId: z.string().min(1),
        toColumnId: z.string().min(1),
      },
      annotations: WRITE,
    },
    ({ connectionId, ...body }) =>
      run(() => api.request(work(connectionId, "/board/move"), { method: "POST", body })),
  );

  server.registerTool(
    "my_activity",
    {
      title: "Minha atividade",
      description:
        "Atividades recentes do feed unificado (commits, pushes, PRs/MRs, reviews, issues…), com a ferramenta de IA detectada em `aiTool`.",
      inputSchema: {
        provider: z.enum(["GITHUB", "GITLAB", "AZURE"]).optional(),
        type: z
          .enum(["COMMIT", "PUSH", "PR", "MR", "ISSUE", "REVIEW", "COMMENT", "RELEASE", "OTHER"])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => run(() => api.request("/api/activity", { query: args })),
  );

  server.registerTool(
    "ai_stats",
    {
      title: "AI Pulse",
      description:
        "Quanto das entregas de código teve participação de IA: total, por ferramenta, série das últimas 12 semanas e detecções recentes.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => api.request("/api/ai/stats")),
  );
}
