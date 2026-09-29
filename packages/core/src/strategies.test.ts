import type { ConflictFile, ConflictHunk, OperationContext } from "@smartmerge/protocol";
import { describe, expect, it, vi } from "vitest";
import { replaceHunk } from "./apply.js";
import { classifyConflict, mentionsRenameConflict } from "./classify.js";
import { llmPayloadPreview } from "./llm.js";
import { proposeForFile } from "./strategies.js";

const operation: OperationContext = {
  operation: "merge",
  current: { label: "main", role: "ours", commitSha: "a" },
  incoming: { label: "topic", role: "theirs", commitSha: "b" },
  mergeBaseSha: "c",
};

function file(hunk: Pick<ConflictHunk, "base" | "current" | "incoming">): ConflictFile {
  return {
    path: "file.txt",
    kind: "content",
    languageId: "text",
    operation,
    hunks: [
      {
        id: "hunk:1",
        range: { startLine: 1, endLine: 5 },
        base: hunk.base,
        current: hunk.current,
        incoming: hunk.incoming,
        temporal: {
          current: { side: "current", commits: [], changeClasses: [], ageMs: null },
          incoming: { side: "incoming", commits: [], changeClasses: [], ageMs: null },
          base: { side: "base", commits: [], changeClasses: [], ageMs: null },
          incomingNewerByMs: null,
        },
        semanticChanges: [],
      },
    ],
  };
}

describe("deterministic strategies", () => {
  it("recommends the shared text when both sides match", () => {
    const proposals = proposeForFile(file({ base: "old", current: "same", incoming: "same" }));
    const chosen = proposals[0];
    expect(chosen?.recommended).toBe("hunk:1:identical");
    expect(chosen?.autoApplyEligible).toBe(false);
    expect(chosen?.candidates[0]).toMatchObject({
      strategy: "identical",
      result: "same",
      confidence: 0.8,
      band: "medium",
      hazardous: false,
    });
  });

  it("keeps the incoming side when current matches the base", () => {
    const proposals = proposeForFile(
      file({ base: "old", current: "old", incoming: "new" }),
      new Set(["hunk:1"]),
    );
    expect(proposals[0]?.recommended).toBe("hunk:1:one-side-unchanged");
    expect(proposals[0]?.candidates[0]?.result).toBe("new");
    expect(proposals[0]?.explanation.headline).toBe("Only one side changed");
  });

  it("keeps the current side when incoming matches the base", () => {
    const proposals = proposeForFile(
      file({ base: "old", current: "new", incoming: "old" }),
      new Set(["hunk:1"]),
    );
    expect(proposals[0]?.candidates[0]?.result).toBe("new");
    expect(proposals[0]?.explanation.bullets[0]).toContain("main");
    expect(proposals[0]?.explanation.bullets[0]).not.toMatch(/\bours\b|\btheirs\b/);
  });

  it("treats a known empty base as unchanged on that side", () => {
    const proposals = proposeForFile(
      file({ base: "", current: "", incoming: "added" }),
      new Set(["hunk:1"]),
    );
    expect(proposals[0]?.recommended).toBe("hunk:1:one-side-unchanged");
    expect(proposals[0]?.candidates[0]?.result).toBe("added");
  });

  it("does not treat an unknown empty base as a match", () => {
    const proposals = proposeForFile(file({ base: "", current: "", incoming: "added" }));
    expect(proposals[0]?.recommended).toBeNull();
  });

  it("treats a CRLF-only difference as whitespace and ignores indentation changes", () => {
    const crlf = proposeForFile(file({ base: "value", current: "value\r\n", incoming: "value\n" }));
    expect(crlf[0]?.recommended).toBe("hunk:1:whitespace-format");
    const indented = proposeForFile(
      file({ base: "old", current: "value", incoming: "  value" }),
      new Set(["hunk:1"]),
    );
    expect(indented[0]?.recommended).toBeNull();
  });

  it("recommends a normalized result when only trailing whitespace differs", () => {
    const proposals = proposeForFile(
      file({ base: "value", current: "value ", incoming: "value\t" }),
    );
    expect(proposals[0]?.recommended).toBe("hunk:1:whitespace-format");
    expect(proposals[0]?.candidates[0]?.result).toBe("value");
    expect(proposals[0]?.explanation.bullets[0]).toContain("No project formatter was run");
  });

  it("leaves both-changed hunks as a manual choice", () => {
    const proposals = proposeForFile(
      file({ base: "old", current: "alpha", incoming: "beta" }),
      new Set(["hunk:1"]),
    );
    expect(proposals[0]?.recommended).toBeNull();
    expect(proposals[0]?.explanation.headline).toBe("No safe automatic choice");
    expect(proposals[0]?.candidates.map((candidate) => candidate.strategy)).toEqual([
      "manual-current",
      "manual-incoming",
      "manual-both-current-first",
      "manual-both-incoming-first",
    ]);
  });

  it("does not call fetch and previews an empty model payload", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    proposeForFile(file({ base: "old", current: "same", incoming: "same" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(llmPayloadPreview()).toEqual({ redactedPayload: "", redactions: 0 });
    fetchSpy.mockRestore();
  });
});

describe("replaceHunk", () => {
  it("replaces the marker range and keeps the surrounding lines", () => {
    const text = "before\n<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> topic\nafter\n";
    const next = replaceHunk(text, { startLine: 2, endLine: 6 }, "alpha");
    expect(next).toBe("before\nalpha\nafter\n");
  });

  it("keeps CRLF newlines in the rest of the file", () => {
    const text = "before\r\n<<<<<<< HEAD\r\nalpha\r\n=======\r\nbeta\r\n>>>>>>> topic\r\nafter\r\n";
    const next = replaceHunk(text, { startLine: 2, endLine: 6 }, "alpha");
    expect(next).toBe("before\r\nalpha\r\nafter\r\n");
  });

  it("deletes the marker block when the replacement is empty", () => {
    const text = "before\n<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> topic\nafter\n";
    expect(replaceHunk(text, { startLine: 2, endLine: 6 }, "")).toBe("before\nafter\n");
  });

  it("rejects a range that does not fall inside the file", () => {
    expect(() => replaceHunk("only\n", { startLine: 2, endLine: 4 }, "x")).toThrow(RangeError);
  });

  it("applies a later hunk before an earlier one without shifting the first range", () => {
    const text =
      "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> t\nmid\n<<<<<<< HEAD\nc\n=======\nd\n>>>>>>> t\n";
    const bottom = replaceHunk(text, { startLine: 7, endLine: 11 }, "c");
    const both = replaceHunk(bottom, { startLine: 1, endLine: 5 }, "a");
    expect(both).toBe("a\nmid\nc\n");
  });
});

describe("classifyConflict", () => {
  it("surfaces add/add, modify/delete, mode, rename/rename, and binary", () => {
    expect(
      classifyConflict({
        binary: false,
        basePresent: false,
        oursPresent: true,
        theirsPresent: true,
        modeDiffers: false,
        contentSame: false,
        renameRename: false,
      }),
    ).toBe("add-add");
    expect(
      classifyConflict({
        binary: false,
        basePresent: true,
        oursPresent: false,
        theirsPresent: true,
        modeDiffers: false,
        contentSame: false,
        renameRename: false,
      }),
    ).toBe("modify-delete");
    expect(
      classifyConflict({
        binary: false,
        basePresent: true,
        oursPresent: true,
        theirsPresent: true,
        modeDiffers: true,
        contentSame: true,
        renameRename: false,
      }),
    ).toBe("mode");
    expect(
      classifyConflict({
        binary: true,
        basePresent: true,
        oursPresent: true,
        theirsPresent: true,
        modeDiffers: false,
        contentSame: false,
        renameRename: false,
      }),
    ).toBe("binary");
    expect(
      classifyConflict({
        binary: false,
        basePresent: true,
        oursPresent: true,
        theirsPresent: true,
        modeDiffers: false,
        contentSame: false,
        renameRename: true,
      }),
    ).toBe("rename-rename");
  });

  it("reads a rename/rename note from git's merge message", () => {
    const message = 'CONFLICT (rename/rename): Rename "old"->"file.txt" in branch "HEAD"';
    expect(mentionsRenameConflict(message, "file.txt")).toBe(true);
    expect(mentionsRenameConflict(message, "other.txt")).toBe(false);
  });
});
