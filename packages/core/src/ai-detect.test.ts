import { describe, expect, it } from "vitest";
import { detectAi } from "./ai-detect.js";
import { azureAiEvidence } from "./adapters/azure.js";
import { githubAiEvidence } from "./adapters/github.js";
import { gitlabAiEvidence } from "./adapters/gitlab.js";

describe("detectAi", () => {
  it("reconhece trailers Co-Authored-By de ferramentas de IA", () => {
    expect(
      detectAi({
        texts: ["fix: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"],
      }),
    ).toEqual({ tool: "claude", signal: "trailer" });
    expect(
      detectAi({ texts: ["feat\n\nCo-authored-by: copilot <copilot@github.com>"] }),
    ).toEqual({ tool: "copilot", signal: "trailer" });
    expect(
      detectAi({ texts: ["x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>"] }),
    ).toEqual({ tool: "cursor", signal: "trailer" });
  });

  it("ignora coautor humano", () => {
    expect(
      detectAi({ texts: ["x\n\nCo-authored-by: Maria Silva <maria@example.com>"] }),
    ).toBeNull();
  });

  it("Generated-by/Assisted-by sempre contam, mesmo com ferramenta desconhecida", () => {
    expect(detectAi({ texts: ["x\n\nAssisted-by: SomeAgent v2"] })).toEqual({
      tool: "other",
      signal: "trailer",
    });
    expect(detectAi({ texts: ["x\n\nGenerated-by: OpenAI Codex"] })).toEqual({
      tool: "codex",
      signal: "trailer",
    });
  });

  it("reconhece o rodapé 'Generated with Claude Code' em PRs", () => {
    expect(
      detectAi({
        texts: ["## Summary\n...\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"],
      }),
    ).toEqual({ tool: "claude", signal: "marker" });
  });

  it("reconhece autores bot de agentes", () => {
    expect(detectAi({ authors: ["copilot-swe-agent[bot]"] })).toEqual({
      tool: "copilot",
      signal: "bot_author",
    });
    expect(detectAi({ authors: ["devin-ai-integration[bot]"] })).toEqual({
      tool: "devin",
      signal: "bot_author",
    });
    expect(detectAi({ authors: ["dependabot[bot]"] })).toBeNull();
  });

  it("reconhece branches de agentes", () => {
    expect(detectAi({ branches: ["refs/heads/claude/fix-login"] })).toEqual({
      tool: "claude",
      signal: "branch",
    });
    expect(detectAi({ branches: ["codex/refactor"] })).toEqual({
      tool: "codex",
      signal: "branch",
    });
    expect(detectAi({ branches: ["feature/claude-integration"] })).toBeNull();
    expect(detectAi({ branches: ["main"] })).toBeNull();
  });

  it("trailer tem prioridade sobre branch", () => {
    expect(
      detectAi({
        texts: ["x\n\nCo-authored-by: Claude <noreply@anthropic.com>"],
        branches: ["copilot/foo"],
      }),
    ).toEqual({ tool: "claude", signal: "trailer" });
  });

  it("sem evidência → null", () => {
    expect(detectAi({})).toBeNull();
    expect(detectAi({ texts: ["fix typo", null], authors: ["ailson"] })).toBeNull();
  });
});

describe("aiEvidence dos adapters + detectAi", () => {
  it("GitHub: trailer em commit de PushEvent", () => {
    const raw = {
      type: "PushEvent",
      payload: {
        ref: "refs/heads/main",
        commits: [
          {
            message: "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
            author: { name: "Ailson", email: "a@x.com" },
          },
        ],
      },
    };
    expect(detectAi(githubAiEvidence(raw))).toEqual({ tool: "claude", signal: "trailer" });
  });

  it("GitHub: branch de agente em PullRequestEvent", () => {
    const raw = {
      type: "PullRequestEvent",
      payload: { pull_request: { title: "Fix", body: null, head: { ref: "copilot/fix-123" } } },
    };
    expect(detectAi(githubAiEvidence(raw))).toEqual({ tool: "copilot", signal: "branch" });
  });

  it("GitHub: commits vindos do enriquecimento (_devpulse)", () => {
    const raw = {
      type: "PushEvent",
      payload: { ref: "refs/heads/main", before: "a", head: "b" },
      _devpulse: {
        commits: [{ message: "x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>" }],
      },
    };
    expect(detectAi(githubAiEvidence(raw))).toEqual({ tool: "cursor", signal: "trailer" });
  });

  it("GitLab: trailer em commit enriquecido", () => {
    const raw = {
      id: 2,
      push_data: { ref: "main", commit_title: "feat" },
      _devpulse: { commits: [{ message: "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>" }] },
    };
    expect(detectAi(gitlabAiEvidence(raw))).toEqual({ tool: "claude", signal: "trailer" });
  });

  it("GitLab: branch do push", () => {
    const raw = { id: 1, push_data: { ref: "codex/refactor", commit_title: "refactor" } };
    expect(detectAi(gitlabAiEvidence(raw))).toEqual({ tool: "codex", signal: "branch" });
  });

  it("Azure: marker na descrição do PR e payload sem evidência", () => {
    const pr = { description: "…\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" };
    expect(detectAi(azureAiEvidence(pr))).toEqual({ tool: "claude", signal: "marker" });
    expect(detectAi(azureAiEvidence({ comment: "fix typo" }))).toBeNull();
    expect(detectAi(azureAiEvidence(null))).toBeNull();
  });
});
