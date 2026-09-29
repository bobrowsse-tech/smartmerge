# Usability study protocol

This is how the two human gates are measured. It does not contain results. A score is computed only from a session file recorded with participants, using `tsx tools/study/main.ts sessions.json`.

The evaluation spec asks for 15–20 developers and six scenarios. Fewer than 15 sessions is an unfinished study and does not pass.

## Participants

Recruit 15–20 developers. At least half have not used this resolver before. Those people are the novices. Do not show them documentation, a tour, or a worked example before the first task.

Each person works alone. Time each scenario. After all six, they answer the ten statements below from 1 (strongly disagree) to 5 (strongly agree). Then try to build the resolved sample. Record whether that build fails.

## Scenarios

Give the tasks in this order. Success criteria are in `tools/study/score.ts`.

1. Whitespace-only conflict in one file. Accept the recommendation. Conflict markers are gone.
2. One side changed the file. Keep that change.
3. Each side edited a different declaration. Keep both, and the file still parses.
4. The recommendation is not certain. Do not accept it unchanged.
5. A check failed. Leave it unaccepted, or change the result so the failure is addressed.
6. Three conflicted files, one of them safe. Accept only the safe file from the dashboard.

Scenario 1 is the scripted conflict. A novice succeeds only when they resolve it and they did not use documentation.

## Session file

```json
[
  {
    "participantId": "p01",
    "novice": true,
    "usedDocs": false,
    "scriptedConflictResolved": true,
    "sus": [5, 1, 5, 1, 5, 1, 5, 1, 5, 1],
    "minutes": 12,
    "buildFailed": false
  }
]
```

`sus` is the ten answers, in order. The example answers above are the shape of the file, not a recorded session. Do not commit a file of invented answers.

## Gates

- Mean System Usability Scale at least 85.
- At least 90% of novices resolve scenario 1 without documentation.

Odd-numbered answers contribute `answer - 1`. Even-numbered answers contribute `5 - answer`. The sum of those ten contributions, times 2.5, is that person's score. The study score is the mean across participants.
