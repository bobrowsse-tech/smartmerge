/**
 * Scores a usability study from recorded sessions.
 * The two gates are the ones in the visual spec: mean System Usability Scale
 * at least 85, and at least 90% of novices resolving the scripted conflict
 * without documentation. Fewer than 15 sessions is an unfinished study.
 */

export const MINIMUM_PARTICIPANTS = 15;
export const MAXIMUM_PARTICIPANTS = 20;
export const SUS_GATE = 85;
export const NOVICE_GATE = 0.9;

/** Standard 10-item instrument. Answers are 1 (strongly disagree) through 5. */
export const SUS_ITEMS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
] as const;

/**
 * Six tasks, in increasing difficulty. The first is the scripted conflict
 * a novice must resolve without documentation.
 */
export const STUDY_SCENARIOS = [
  {
    id: "whitespace",
    difficulty: 1,
    task: "A single file conflicts only by whitespace. Accept the recommendation. The file must no longer contain conflict markers.",
  },
  {
    id: "one-side",
    difficulty: 2,
    task: "Only one side changed the file. Keep that change.",
  },
  {
    id: "both-declarations",
    difficulty: 3,
    task: "Each side edited a different declaration. Keep both edits, and the file must still parse.",
  },
  {
    id: "needs-review",
    difficulty: 4,
    task: "The recommendation is not certain. Do not accept it unchanged. Choose a side or edit the result.",
  },
  {
    id: "failing-check",
    difficulty: 5,
    task: "A check failed. Leave that conflict unaccepted, or change the result so the failure is addressed.",
  },
  {
    id: "dashboard-safe",
    difficulty: 6,
    task: "Three files conflict and only one is safe to accept. Accept that file from the dashboard and leave the other two conflicted.",
  },
] as const;

export type SusAnswers = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface StudySession {
  participantId: string;
  novice: boolean;
  usedDocs: boolean;
  /** Scenario 1 finished with no conflict markers. */
  scriptedConflictResolved: boolean;
  sus: SusAnswers;
  minutes: number;
  buildFailed: boolean;
}

export type StudyReport =
  | { complete: false; participants: number; required: number }
  | {
      complete: true;
      participants: number;
      sus: number;
      noviceSuccess: number;
      novices: number;
      buildFailures: number;
      susPasses: boolean;
      novicePasses: boolean;
      passes: boolean;
    };

/** One participant's SUS, from 0 to 100. Odd items are positive. */
export function susScore(items: readonly number[]): number {
  if (items.length !== SUS_ITEMS.length) throw new Error("SUS has 10 answers");
  let sum = 0;
  for (let index = 0; index < items.length; index += 1) {
    const answer = items[index];
    if (answer === undefined || !Number.isInteger(answer) || answer < 1 || answer > 5) {
      throw new Error("Each SUS answer is an integer from 1 to 5");
    }
    sum += index % 2 === 0 ? answer - 1 : 5 - answer;
  }
  return sum * 2.5;
}

/** Score recorded sessions. An unfinished study does not pass either gate. */
export function scoreStudy(input: unknown): StudyReport {
  const sessions = parseSessions(input);
  if (sessions.length < MINIMUM_PARTICIPANTS || sessions.length > MAXIMUM_PARTICIPANTS) {
    return { complete: false, participants: sessions.length, required: MINIMUM_PARTICIPANTS };
  }
  const susValues = sessions.map((session) => susScore(session.sus));
  const sus = susValues.reduce((total, value) => total + value, 0) / sessions.length;
  const novices = sessions.filter((session) => session.novice);
  const noviceSuccesses = novices.filter(
    (session) => session.scriptedConflictResolved && !session.usedDocs,
  ).length;
  const noviceSuccess = novices.length === 0 ? 0 : noviceSuccesses / novices.length;
  const susPasses = sus >= SUS_GATE;
  const novicePasses = novices.length > 0 && noviceSuccess >= NOVICE_GATE;
  return {
    complete: true,
    participants: sessions.length,
    sus,
    noviceSuccess,
    novices: novices.length,
    buildFailures: sessions.filter((session) => session.buildFailed).length,
    susPasses,
    novicePasses,
    passes: susPasses && novicePasses,
  };
}

function parseSessions(input: unknown): StudySession[] {
  if (!Array.isArray(input)) throw new Error("Sessions must be an array");
  const seen = new Set<string>();
  return input.map((item) => parseSession(item, seen));
}

function parseSession(input: unknown, seen: Set<string>): StudySession {
  if (typeof input !== "object" || input === null) throw new Error("A session must be an object");
  const record = input as Record<string, unknown>;
  const participantId = record["participantId"];
  if (typeof participantId !== "string" || participantId.length === 0) {
    throw new Error("participantId is required");
  }
  if (seen.has(participantId)) throw new Error(`Duplicate participant ${participantId}`);
  seen.add(participantId);
  const sus = record["sus"];
  if (!Array.isArray(sus) || sus.length !== 10) throw new Error("sus must be 10 answers");
  const answers = sus.map((answer) => {
    if (typeof answer !== "number") throw new Error("Each SUS answer is an integer from 1 to 5");
    return answer;
  });
  susScore(answers);
  const minutes = record["minutes"];
  if (typeof minutes !== "number" || minutes < 0) throw new Error("minutes must be zero or more");
  return {
    participantId,
    novice: requiredBoolean(record["novice"], "novice"),
    usedDocs: requiredBoolean(record["usedDocs"], "usedDocs"),
    scriptedConflictResolved: requiredBoolean(
      record["scriptedConflictResolved"],
      "scriptedConflictResolved",
    ),
    sus: tuple(answers),
    minutes,
    buildFailed: requiredBoolean(record["buildFailed"], "buildFailed"),
  };
}

function tuple(answers: readonly number[]): SusAnswers {
  const [a, b, c, d, e, f, g, h, i, j] = answers;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined ||
    g === undefined ||
    h === undefined ||
    i === undefined ||
    j === undefined
  ) {
    throw new Error("SUS has 10 answers");
  }
  return [a, b, c, d, e, f, g, h, i, j];
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}
