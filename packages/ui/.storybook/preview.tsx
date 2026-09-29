import type { Decorator, Preview } from "@storybook/react-vite";
import { panelCss } from "../src/tokens.js";

const theme: Decorator = (Story, context) => {
  const selected = context.globals["theme"];
  const name = selected === "dark" || selected === "contrast" ? selected : "light";
  return (
    <div data-theme={name}>
      <style>{panelCss}</style>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [theme],
  globalTypes: {
    theme: {
      description: "Panel theme",
      toolbar: {
        title: "Theme",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
          { value: "contrast", title: "High contrast" },
        ],
      },
    },
  },
  initialGlobals: { theme: "light" },
};

export default preview;
