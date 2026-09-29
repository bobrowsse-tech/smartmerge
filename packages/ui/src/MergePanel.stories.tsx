import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleProposal, sampleSession } from "./fixtures.js";
import { MergePanel } from "./MergePanel.js";
import { panelModel, type PanelInput } from "./model.js";

const base: PanelInput = {
  connected: true,
  loading: false,
  applying: false,
  error: null,
  llmEnabled: false,
  offline: true,
  undoAvailable: false,
  session: null,
  selectedIndex: 0,
};

function view(input: PanelInput): StoryObj<typeof meta> {
  return { render: () => <MergePanel model={panelModel(input)} /> };
}

const meta = {
  title: "Merge panel",
  component: MergePanel,
} satisfies Meta<typeof MergePanel>;

export default meta;

export const Loading = view({ ...base, loading: true });
export const Empty = view(base);
export const Disconnected = view({ ...base, connected: false });
export const ErrorState = view({ ...base, error: "Daemon failed." });
export const Applying = view({ ...base, applying: true });
export const Applied = view({ ...base, undoAvailable: true });
export const Single = view({ ...base, session: sampleSession([sampleProposal("medium")]) });
export const Many = view({
  ...base,
  session: sampleSession([sampleProposal("high"), sampleProposal("low")]),
  selectedIndex: 1,
});
export const High = view({ ...base, session: sampleSession([sampleProposal("high")]) });
export const Low = view({ ...base, session: sampleSession([sampleProposal("low")]) });
export const Hazardous = view({
  ...base,
  session: sampleSession([sampleProposal("low", { hazardous: true, status: "fail" })]),
});
export const Unknown = view({
  ...base,
  session: sampleSession([sampleProposal("medium", { status: "unknown" })]),
});
export const Unsupported = view({
  ...base,
  session: sampleSession([sampleProposal("medium")], null),
});
export const Offline = view({ ...base, session: sampleSession([sampleProposal("medium")]) });
export const ModelOff = view({ ...base, session: sampleSession([sampleProposal("medium")]) });
export const ModelOn = view({
  ...base,
  llmEnabled: true,
  session: sampleSession([sampleProposal("medium")]),
});
