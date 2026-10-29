import { describe, expect, it } from "vitest";
import {
  mapGithubCard,
  mapGithubIssue,
  columnQuery,
  mapProjectFields,
  parseProjectFieldId,
  type GhIssue,
} from "./github.js";
import {
  applyScopedLabels,
  distributeGitlabBoard,
  mapGitlabIssue,
  scopedLabelFields,
  type GlIssue,
} from "./gitlab.js";
import {
  azureColumnOf,
  buildAzureFields,
  flattenNodes,
  mapAzureItem,
  parseArtifactLink,
} from "./azure.js";
import { missingWorkScopes } from "./scopes.js";
import { htmlToText, splitRef, textToHtml } from "./util.js";
import { workErrorFromStatus, ScopeError, WorkNotFoundError } from "./errors.js";
import { AuthError } from "../adapters/types.js";

describe("util", () => {
  it("splitRef separa pelo último #", () => {
    expect(splitRef("My Project#42")).toEqual({ container: "My Project", id: "42" });
    expect(splitRef("owner/repo#7")).toEqual({ container: "owner/repo", id: "7" });
  });
  it("splitRef rejeita refs inválidas", () => {
    expect(() => splitRef("sem-id")).toThrow();
    expect(() => splitRef("repo#abc")).toThrow();
  });
  it("html ↔ texto", () => {
    expect(htmlToText("<div>a &amp; b</div><div>c<br>d</div>")).toBe("a & b\nc\nd");
    expect(textToHtml("<x>\ny")).toBe("&lt;x&gt;<br>y");
  });
});

describe("workErrorFromStatus", () => {
  it("mapeia status para erros de domínio", () => {
    expect(workErrorFromStatus("X", 401)).toBeInstanceOf(AuthError);
    expect(workErrorFromStatus("X", 403)).toBeInstanceOf(ScopeError);
    expect(workErrorFromStatus("X", 403, "API rate limit exceeded")).not.toBeInstanceOf(ScopeError);
    expect(workErrorFromStatus("X", 404)).toBeInstanceOf(WorkNotFoundError);
  });
});

describe("missingWorkScopes", () => {
  it("aponta escopos faltantes só em OAuth", () => {
    expect(missingWorkScopes("GITLAB", "OAUTH", ["read_user", "read_api"])).toEqual(["api"]);
    expect(missingWorkScopes("GITHUB", "OAUTH", ["repo", "project", "read:user"])).toEqual([
      "read:org",
    ]);
    expect(
      missingWorkScopes("GITHUB", "OAUTH", ["repo", "project", "read:org", "read:user"]),
    ).toEqual([]);
    expect(missingWorkScopes("GITLAB", "PAT", [])).toEqual([]);
  });
});

describe("GitHub", () => {
  const issue: GhIssue = {
    number: 12,
    title: "Bug",
    state: "closed",
    html_url: "https://github.com/acme/app/issues/12",
    repository_url: "https://api.github.com/repos/acme/app",
    labels: ["bug", { name: "p1" }],
    assignees: [{ login: "ana", avatar_url: "a.png" }],
    user: { login: "bob" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  it("mapeia issue", () => {
    const it = mapGithubIssue(issue);
    expect(it.ref).toBe("acme/app#12");
    expect(it.state).toBe("closed");
    expect(it.labels).toEqual(["bug", "p1"]);
    expect(it.container).toEqual({ id: "acme/app", name: "acme/app", url: "https://github.com/acme/app" });
    expect(it.assignees[0]?.login).toBe("ana");
  });

  it("mapeia card de project (issue e rascunho)", () => {
    const card = mapGithubCard("PVTI_1", {
      __typename: "Issue",
      number: 3,
      title: "T",
      url: "u",
      repository: { nameWithOwner: "acme/app" },
    });
    expect(card.ref).toBe("acme/app#3");
    const draft = mapGithubCard("PVTI_2", { __typename: "DraftIssue", title: "D" });
    expect(draft.ref).toBeNull();
    expect(draft.kind).toBe("rascunho");
  });
});

describe("GitLab", () => {
  const base = {
    project_id: 5,
    description: null,
    web_url: "https://gitlab.com/g/p/-/issues/1",
    assignees: [],
    author: { username: "ana" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    references: { full: "g/p#1" },
  };
  const mk = (iid: number, labels: string[], state = "opened"): GlIssue => ({
    ...base,
    iid,
    title: `i${iid}`,
    labels,
    state,
  });

  it("mapeia issue", () => {
    const it = mapGitlabIssue(mk(1, ["x"]));
    expect(it.ref).toBe("5#1");
    expect(it.container.name).toBe("g/p");
    expect(it.container.url).toBe("https://gitlab.com/g/p");
    expect(it.state).toBe("open");
  });

  it("distribui o board por label de lista (na ordem das listas)", () => {
    const board = {
      id: 1,
      name: "B",
      lists: [
        { id: 20, position: 1, label: { name: "Doing" } },
        { id: 10, position: 0, label: { name: "To do" } },
        { id: 30, position: 2, label: null },
      ],
    };
    const cols = distributeGitlabBoard(
      board,
      [mk(1, []), mk(2, ["Doing", "To do"]), mk(3, ["Doing"])],
      [mk(4, ["Doing"], "closed")],
    );
    expect(cols.map((c) => c.name)).toEqual(["Open", "To do", "Doing", "Closed"]);
    expect(cols.map((c) => c.cards.map((x) => x.number))).toEqual([
      ["#1"],
      ["#2"],
      ["#3"],
      ["#4"],
    ]);
  });
});

describe("Azure", () => {
  const base = "https://dev.azure.com/org";
  const w = (fields: Record<string, unknown>) => ({
    id: 9,
    fields: {
      "System.TeamProject": "My Proj",
      "System.Title": "Fix",
      "System.WorkItemType": "Bug",
      "System.State": "Active",
      "System.Tags": "a; b",
      "System.AssignedTo": { displayName: "Ana", uniqueName: "ana@x.com" },
      ...fields,
    },
  });

  it("mapeia work item", () => {
    const it = mapAzureItem(base, w({}));
    expect(it.ref).toBe("My Proj#9");
    expect(it.url).toBe("https://dev.azure.com/org/My%20Proj/_workitems/edit/9");
    expect(it.labels).toEqual(["a", "b"]);
    expect(it.assignees).toEqual([{ login: "ana@x.com", name: "Ana", avatarUrl: null }]);
    expect(it.state).toBe("open");
    expect(mapAzureItem(base, w({ "System.State": "Done" })).state).toBe("closed");
  });

  it("coluna do card: campo Kanban ou mapeamento de estado", () => {
    const board = {
      id: "b",
      name: "Stories",
      columns: [
        { id: "1", name: "New", stateMappings: { Bug: "New" } },
        { id: "2", name: "Doing", stateMappings: { Bug: "Active" } },
      ],
    };
    const field = "WEF_X_Kanban.Column";
    expect(azureColumnOf(board, field, w({ [field]: "New" }))).toBe("New");
    expect(azureColumnOf(board, field, w({}))).toBe("Doing");
    expect(azureColumnOf(board, field, w({ "System.State": "Weird" }))).toBeUndefined();
  });
});

describe("campos — GitHub Projects", () => {
  const project = {
    id: "P1",
    title: "Roadmap",
    fields: {
      nodes: [
        { id: "F0", name: "Title", dataType: "TITLE" },
        { id: "FS", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Todo" }] },
        {
          id: "FP",
          name: "Priority",
          dataType: "SINGLE_SELECT",
          options: [{ id: "p0", name: "P0", color: "RED" }],
        },
        { id: "FE", name: "Estimate", dataType: "NUMBER" },
        {
          id: "FI",
          name: "Sprint",
          dataType: "ITERATION",
          configuration: { iterations: [{ id: "it1", title: "Sprint 1", startDate: "2026-10-01" }] },
        },
        {},
      ],
    },
  };

  it("mapeia tipos suportados, valores e ids pf:*", () => {
    const fields = mapProjectFields(project, [
      { optionId: "p0", field: { id: "FP" } },
      { number: 3, field: { id: "FE" } },
      { iterationId: "it1", field: { id: "FI" } },
    ]);
    expect(fields.map((f) => f.name)).toEqual(["Status", "Priority", "Estimate", "Sprint"]);
    const prio = fields.find((f) => f.name === "Priority")!;
    expect(prio).toMatchObject({ id: "pf:P1:FP:s", type: "single_select", value: "p0", group: "Roadmap" });
    expect(prio.options?.[0]?.color).toBe("#cf222e");
    expect(fields.find((f) => f.name === "Estimate")).toMatchObject({ type: "number", value: 3 });
    expect(fields.find((f) => f.name === "Sprint")).toMatchObject({ type: "single_select", value: "it1" });
    expect(parseProjectFieldId("pf:P1:FE:n")).toEqual({ projectId: "P1", fieldId: "FE", kind: "n" });
    expect(parseProjectFieldId("milestone")).toBeNull();
  });

  it("omite Status na criação pelo board", () => {
    const fields = mapProjectFields(project, [], { includeStatus: false });
    expect(fields.some((f) => f.name === "Status")).toBe(false);
  });
});

describe("campos — GitLab labels com escopo", () => {
  const labels = [
    { name: "priority::high", color: "#f00" },
    { name: "priority::low" },
    { name: "Doing" },
  ];
  it("agrupa por escopo com o valor atual", () => {
    const [f] = scopedLabelFields(labels, ["Doing", "priority::low"]);
    expect(f).toMatchObject({ id: "scoped:priority", name: "Priority", value: "priority::low" });
    expect(f!.options?.map((o) => o.name)).toEqual(["high", "low"]);
  });
  it("troca a label do escopo e preserva as demais", () => {
    expect(applyScopedLabels(["Doing", "priority::low"], { "scoped:priority": "priority::high" })).toEqual([
      "Doing",
      "priority::high",
    ]);
    expect(applyScopedLabels(["priority::low"], { "scoped:priority": null })).toEqual([]);
  });
});

describe("campos — Azure", () => {
  it("achata a árvore de iterações em caminhos", () => {
    expect(
      flattenNodes({ name: "Proj", children: [{ name: "R1", children: [{ name: "S1" }] }] }),
    ).toEqual(["Proj", "Proj\\R1", "Proj\\R1\\S1"]);
  });

  it("monta campos conhecidos e Custom.* conforme o tipo", () => {
    const defs = new Map([
      ["Microsoft.VSTS.Common.Priority", { referenceName: "x", name: "Priority", type: "integer" }],
      ["Microsoft.VSTS.Scheduling.Effort", { referenceName: "x", name: "Effort", type: "double" }],
      ["Custom.Squad", { referenceName: "x", name: "Squad", type: "string" }],
      ["System.CreatedBy", { referenceName: "x", name: "Created By", type: "identity" }],
    ]);
    const fields = buildAzureFields(
      [
        { referenceName: "Custom.Squad", name: "Squad", allowedValues: ["A", "B"] },
        { referenceName: "Microsoft.VSTS.Scheduling.Effort", name: "Effort" },
        { referenceName: "Microsoft.VSTS.Common.Priority", name: "Priority", allowedValues: ["1", "2"] },
        { referenceName: "System.IterationPath", name: "Iteration Path" },
        { referenceName: "System.CreatedBy", name: "Created By" },
      ],
      defs,
      { iterations: ["Proj", "Proj\\S1"], areas: [] },
      { "Microsoft.VSTS.Common.Priority": 2, "Microsoft.VSTS.Scheduling.Effort": 5 },
    );
    expect(fields.map((f) => f.id)).toEqual([
      "Microsoft.VSTS.Common.Priority",
      "Microsoft.VSTS.Scheduling.Effort",
      "System.IterationPath",
      "Custom.Squad",
    ]);
    expect(fields[0]).toMatchObject({ name: "Prioridade", type: "single_select", value: "2" });
    expect(fields[1]).toMatchObject({ type: "number", value: 5 });
  });

  it("interpreta links de branch e PR", () => {
    expect(parseArtifactLink("vstfs:///Git/Ref/p1%2Fr1%2FGBfeature%2Fx")).toEqual({
      kind: "branch",
      repoId: "r1",
      name: "feature/x",
    });
    expect(parseArtifactLink("vstfs:///Git/PullRequestId/p1%2Fr1%2F42")).toEqual({
      kind: "pull_request",
      repoId: "r1",
      id: "42",
    });
    expect(parseArtifactLink("vstfs:///Build/Build/1")).toBeNull();
  });
});

describe("columnQuery (GitHub)", () => {
  it("filtra por status com aspas escapadas ou sem status", () => {
    expect(columnQuery("In Progress")).toBe('status:"In Progress"');
    expect(columnQuery('Say "hi"')).toBe('status:"Say \\"hi\\""');
    expect(columnQuery(null)).toBe("no:status");
  });
});
