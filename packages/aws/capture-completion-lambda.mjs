import { createAwsCaptureCompletionRuntimeEntrypoint } from "./dist/index.js";

const runtime = createAwsCaptureCompletionRuntimeEntrypoint(process.env);

export async function handler(event) {
  return runtime.handler(event);
}
