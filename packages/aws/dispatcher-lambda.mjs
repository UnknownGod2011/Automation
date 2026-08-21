import { createAwsSchedulingComposition } from "./dist/index.js";

let dispatchHandler;

function getDispatchHandler() {
  if (dispatchHandler) return dispatchHandler;
  const result = createAwsSchedulingComposition(process.env);
  if (!result.configured) {
    throw new Error("scheduled dispatcher is not configured");
  }
  dispatchHandler = result.composition.dispatchHandler;
  return dispatchHandler;
}

export async function handler(event) {
  return getDispatchHandler().handle(event);
}
