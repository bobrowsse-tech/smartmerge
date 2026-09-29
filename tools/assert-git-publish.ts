/**
 * Blocks npm publish unless this process is the git tag workflow.
 * The workflow must already have proven the tag points at main.
 */
const onActions = process.env["GITHUB_ACTIONS"] === "true";
const event = process.env["GITHUB_EVENT_NAME"] ?? "";
const ref = process.env["GITHUB_REF"] ?? "";
const tagOnWorkflow = event === "push" && /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref);

if (!onActions || !tagOnWorkflow) {
  console.error(
    "Refusing to publish. Packages publish only from the git tag workflow, and only when that tag points at main.",
  );
  process.exit(1);
}
