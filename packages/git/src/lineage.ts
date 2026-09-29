import type {
  ChangeClass,
  CommitInfo,
  ConflictFile,
  LinkedRef,
  SideContext,
} from "@smartmerge/protocol";
import { git } from "./run.js";

/**
 * Attach commit subjects for each conflict range.
 * History is informational. It never decides a resolution.
 * A missing or unreadable range leaves that side empty.
 */
export async function enrichLineage(repoRoot: string, file: ConflictFile): Promise<ConflictFile> {
  const hunks = [];
  for (const hunk of file.hunks) {
    const currentCommits = await readRangeCommits(
      repoRoot,
      file.path,
      file.operation.current.commitSha,
      hunk.range.startLine,
      hunk.range.endLine,
    );
    const incomingCommits = await readRangeCommits(
      repoRoot,
      file.path,
      file.operation.incoming.commitSha,
      hunk.range.startLine,
      hunk.range.endLine,
    );
    const current = toSide("current", currentCommits);
    const incoming = toSide("incoming", incomingCommits);
    hunks.push({
      ...hunk,
      temporal: {
        current,
        incoming,
        base: hunk.temporal.base,
        incomingNewerByMs: newerBy(current.ageMs, incoming.ageMs),
      },
    });
  }
  return { ...file, hunks };
}

/** Commits that last touched `startLine` through `endLine` of `path` at `sha`, oldest first. */
export async function readRangeCommits(
  repoRoot: string,
  path: string,
  sha: string,
  startLine: number,
  endLine: number,
): Promise<CommitInfo[]> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return [];
  const start = Math.max(1, Math.trunc(startLine));
  const end = Math.max(start, Math.trunc(endLine));
  const result = await git(
    repoRoot,
    [
      "--no-pager",
      "log",
      `-L${String(start)},${String(end)}:${path}`,
      "-n",
      "5",
      "--format=%H%x1f%an%x1f%aI%x1f%s",
      sha,
    ],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) return [];
  return parseCommitLog(result.stdout);
}

/**
 * Parse `git log --format=%H%x1f%an%x1f%aI%x1f%s` output.
 * Line-history diffs that follow each record are ignored. Newest commits come back oldest-first.
 */
export function parseCommitLog(stdout: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  for (const line of stdout.split("\n")) {
    const parts = line.split("\u001f");
    const sha = parts[0];
    const author = parts[1];
    const authoredAt = parts[2];
    const subject = parts.slice(3).join("\u001f");
    if (!sha || !author || !authoredAt || parts.length < 4 || !/^[0-9a-f]{7,64}$/i.test(sha)) {
      continue;
    }
    commits.push({ sha, author, authoredAt, subject, refs: refsFrom(subject) });
  }
  return commits.reverse();
}

function toSide(side: SideContext["side"], commits: CommitInfo[]): SideContext {
  const newest = commits.at(-1);
  const changeClasses: ChangeClass[] = [];
  for (const commit of commits) {
    const change = changeClass(commit.subject);
    if (!changeClasses.includes(change)) changeClasses.push(change);
  }
  return {
    side,
    commits,
    changeClasses,
    ageMs: newest ? ageOf(newest.authoredAt) : null,
  };
}

function newerBy(currentAge: number | null, incomingAge: number | null): number | null {
  if (currentAge === null || incomingAge === null) return null;
  return currentAge - incomingAge;
}

function ageOf(authoredAt: string): number | null {
  const time = Date.parse(authoredAt);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Date.now() - time);
}

function changeClass(subject: string): ChangeClass {
  if (/^rename\b/i.test(subject)) return "rename";
  if (/^(docs?|comment)\b/i.test(subject)) return "comment";
  if (/\bformat\b/i.test(subject)) return "formatting";
  return "logic";
}

function refsFrom(subject: string): LinkedRef[] {
  const refs: LinkedRef[] = [];
  for (const match of subject.matchAll(/#(\d+)/g)) {
    const id = match[1];
    if (id) refs.push({ kind: "issue", id: `#${id}` });
  }
  for (const match of subject.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)) {
    const id = match[1];
    if (id) refs.push({ kind: "ticket", id });
  }
  return refs;
}
