/**
 * Payload that would be sent to a model.
 * The model tier is off, so this is empty and no network call is made.
 */
export function llmPayloadPreview(): { redactedPayload: string; redactions: number } {
  return { redactedPayload: "", redactions: 0 };
}
