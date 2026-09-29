import { describe, expect, it } from "vitest";
import {
  MINIMUM_PARTICIPANTS,
  STUDY_SCENARIOS,
  SUS_ITEMS,
  scoreStudy,
  susScore,
  type StudySession,
} from "./score.js";

describe("usability study score", () => {
  it("uses the standard SUS weights", () => {
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75);
  });

  it("refuses a short study instead of treating it as a pass", () => {
    const report = scoreStudy([session("p1", true)]);
    expect(report.complete).toBe(false);
    if (!report.complete) expect(report.required).toBe(MINIMUM_PARTICIPANTS);
  });

  it("passes only when both gates are met by a full study", () => {
    const passing = scoreStudy(sessions(true));
    expect(passing.complete).toBe(true);
    if (passing.complete) {
      expect(passing.sus).toBe(100);
      expect(passing.noviceSuccess).toBe(1);
      expect(passing.passes).toBe(true);
    }
    const failing = scoreStudy(sessions(false));
    expect(failing.complete).toBe(true);
    if (failing.complete) expect(failing.passes).toBe(false);
  });

  it("does not count a novice who needed documentation", () => {
    const people = sessions(true).map((person, index) =>
      index < 2 ? { ...person, usedDocs: true, scriptedConflictResolved: true } : person,
    );
    const report = scoreStudy(people);
    expect(report.complete).toBe(true);
    if (report.complete) {
      expect(report.noviceSuccess).toBeCloseTo(13 / 15);
      expect(report.novicePasses).toBe(false);
    }
  });

  it("lists six scenarios and the ten SUS items", () => {
    expect(STUDY_SCENARIOS).toHaveLength(6);
    expect(SUS_ITEMS).toHaveLength(10);
    expect(STUDY_SCENARIOS[0].id).toBe("whitespace");
  });
});

function sessions(successful: boolean): StudySession[] {
  return Array.from({ length: MINIMUM_PARTICIPANTS }, (_, index) =>
    session(`p${String(index)}`, successful),
  );
}

function session(participantId: string, successful: boolean): StudySession {
  return {
    participantId,
    novice: true,
    usedDocs: false,
    scriptedConflictResolved: successful,
    sus: successful ? [5, 1, 5, 1, 5, 1, 5, 1, 5, 1] : [1, 5, 1, 5, 1, 5, 1, 5, 1, 5],
    minutes: 12,
    buildFailed: !successful,
  };
}
