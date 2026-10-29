#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./client.js";
import { registerTools } from "./tools.js";

/**
 * Servidor MCP (stdio) do DevPulse para o Claude Code.
 * Config: DEVPULSE_URL (default http://localhost:3000) e DEVPULSE_TOKEN.
 */
async function main() {
  const api = clientFromEnv();
  const server = new McpServer(
    { name: "devpulse", version: "0.0.1" },
    {
      instructions:
        "Ferramentas para as tarefas (issues/work items), boards e atividade do usuário no DevPulse, " +
        "unificando GitHub, GitLab e Azure DevOps. Fluxo típico: list_tasks → get_task → " +
        "(trabalhar no código) → comment_task / update_task; para boards: list_boards → get_board → move_card. " +
        "Toda ferramenta que age numa tarefa precisa do connectionId e da ref que vêm em list_tasks.",
    },
  );
  registerTools(server, api);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // stdout é o canal do protocolo; diagnóstico vai para stderr.
  console.error("[devpulse-mcp]", err instanceof Error ? err.message : err);
  process.exit(1);
});
