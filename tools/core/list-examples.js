import { ExampleIndex } from "./results.js";

export function listExamples(normalized) {
  return new ExampleIndex({ sections: normalized.sections });
}
