import { createAwsControlPlaneRuntimeEntrypoint } from "./dist/index.js";

const runtime = createAwsControlPlaneRuntimeEntrypoint(process.env);

export async function handler(event) {
  return runtime.handler(event);
}
