import { ExampleIndex } from "./results.js";

export function listExamples(normalized) {
  if (!normalized.section) {
    return new ExampleIndex({ section: null });
  }
  return new ExampleIndex({ section: normalized.section });
}
