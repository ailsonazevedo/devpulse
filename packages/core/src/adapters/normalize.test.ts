import { describe, expect, it } from "vitest";
import { reviewStateOf as githubReviewState } from "./github.js";
import {
  isReviewEvent,
  mapType as gitlabMapType,
  reviewStateOf as gitlabReviewState,
  type GitlabEvent,
} from "./gitlab.js";
import { voteToReviewState } from "./azure.js";

const glEvent = (over: Partial<GitlabEvent>): GitlabEvent => ({
  id: 1,
  action_name: "opened",
  target_type: null,
  target_title: null,
  created_at: new Date().toISOString(),
  project_id: 10,
  ...over,
});

describe("github reviewStateOf", () => {
  it("mapeia estados de review do GitHub", () => {
    expect(githubReviewState("approved")).toBe("approved");
    expect(githubReviewState("changes_requested")).toBe("changes_requested");
    expect(githubReviewState("commented")).toBe("commented");
    expect(githubReviewState("dismissed")).toBe("commented");
    expect(githubReviewState(undefined)).toBeNull();
  });
});

describe("gitlab mapType", () => {
  it("aprovação de MR vira REVIEW (não MR)", () => {
    const ev = glEvent({ action_name: "approved", target_type: "MergeRequest" });
    expect(isReviewEvent(ev)).toBe(true);
    expect(gitlabMapType(ev)).toBe("REVIEW");
    expect(gitlabReviewState(ev)).toBe("approved");
  });

  it("MR comum é unificado como PR", () => {
    const ev = glEvent({ action_name: "opened", target_type: "MergeRequest" });
    expect(gitlabMapType(ev)).toBe("PR");
    expect(gitlabReviewState(ev)).toBeNull();
  });

  it("remoção de aprovação volta a pending", () => {
    const ev = glEvent({ action_name: "unapproved", target_type: "MergeRequest" });
    expect(gitlabMapType(ev)).toBe("REVIEW");
    expect(gitlabReviewState(ev)).toBe("pending");
  });

  it("push vira PUSH; nota vira COMMENT; issue vira ISSUE", () => {
    expect(gitlabMapType(glEvent({ action_name: "pushed to" }))).toBe("PUSH");
    expect(gitlabMapType(glEvent({ target_type: "DiffNote" }))).toBe("COMMENT");
    expect(gitlabMapType(glEvent({ target_type: "Issue" }))).toBe("ISSUE");
  });
});

describe("azure voteToReviewState", () => {
  it("mapeia votos do Azure", () => {
    expect(voteToReviewState(10)).toBe("approved");
    expect(voteToReviewState(5)).toBe("approved");
    expect(voteToReviewState(-5)).toBe("pending");
    expect(voteToReviewState(-10)).toBe("rejected");
    expect(voteToReviewState(0)).toBeNull();
  });
});
