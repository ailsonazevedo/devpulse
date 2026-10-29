import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildClaudeCommand, claudeBranch, slugify } from "./claude";

describe("claudeBranch", () => {
  it("usa número e slug sem acentos", () => {
    expect(claudeBranch({ number: "#123", title: "Corrigir Login no Safári!" })).toBe(
      "claude/123-corrigir-login-no-safari",
    );
  });

  it("corta slugs longos sem hífen no fim", () => {
    expect(slugify("a".repeat(39) + " bbbb")).toBe("a".repeat(39));
  });
});

describe("buildClaudeCommand", () => {
  it("o shell recebe o prompt literal (aspas, $ e crases não são interpretados)", () => {
    const ref = "o/r'$HOME`x`#7";
    const cmd = buildClaudeCommand("c1", { ref, number: "#7", title: "Don't break" });
    expect(cmd.startsWith("claude '")).toBe(true);
    const arg = execFileSync("sh", ["-c", `printf %s ${cmd.slice("claude ".length)}`], {
      encoding: "utf8",
    });
    expect(arg).toContain(`tarefa ${ref} do DevPulse (connectionId c1)`);
    expect(arg).toContain("claude/7-don-t-break");
  });
});
