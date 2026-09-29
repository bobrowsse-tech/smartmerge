import type { DashboardSummary } from "@smartmerge/protocol";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MergeDashboard } from "./MergeDashboard.js";

const summary: DashboardSummary = {
  rows: [
    {
      path: "src/blocked.ts",
      languageId: "typescript",
      hunkCount: 1,
      topStrategy: "structural-3way",
      confidence: 0.2,
      band: "low",
      checks: { syntax: "fail", symbols: "unknown" },
      risk: 1,
      group: "blocked",
    },
    {
      path: "src/review.ts",
      languageId: "typescript",
      hunkCount: 2,
      topStrategy: "whitespace-format",
      confidence: 0.8,
      band: "medium",
      checks: { syntax: "pass", symbols: "pass" },
      risk: 0.2,
      group: "needs-review",
    },
    {
      path: "src/ready.ts",
      languageId: "typescript",
      hunkCount: 1,
      topStrategy: "identical",
      confidence: 0.99,
      band: "certain",
      checks: { syntax: "pass", symbols: "pass" },
      risk: 0,
      group: "ready",
    },
  ],
  totals: { files: 3, hunks: 4, resolved: 1, safeToAccept: 1 },
};

const meta = {
  title: "Merge dashboard",
  component: MergeDashboard,
} satisfies Meta<typeof MergeDashboard>;

export default meta;

export const Mixed: StoryObj<typeof meta> = { args: { summary } };

export const Empty: StoryObj<typeof meta> = {
  args: {
    summary: {
      rows: [],
      totals: { files: 0, hunks: 0, resolved: 0, safeToAccept: 0 },
    },
  },
};
