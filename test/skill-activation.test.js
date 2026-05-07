import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const here = dirname(fileURLToPath(import.meta.url));
const buildScript = resolve(here, "..", "scripts", "build-skill.js");

function tutucaSkillDescription() {
  const src = readFileSync(buildScript, "utf8");
  const desc = src.match(/^description:\s*([\s\S]*?)\n---/m);
  if (!desc) throw new Error("description field not found in build-skill.js");
  return desc[1].toLowerCase();
}

const description = tutucaSkillDescription();

const cases = [
  {
    prompt: "add a button to my Counter component",
    terms: ["component", "tutuca"],
  },
  {
    prompt: "fix this @on.click handler in a tutuca view",
    terms: ["@", "handler"],
  },
  {
    prompt: "implement a bubble handler that aggregates child selections",
    terms: ["bubble"],
  },
  {
    prompt: "write a getTests export for my Counter",
    terms: ["gettests"],
  },
  {
    prompt: "run the tutuca cli to lint a module",
    terms: ["lint", "cli"],
  },
  {
    prompt: "verify my edit with tutuca render and tutuca test",
    terms: ["render", "test"],
  },
];

describe("tutuca skill activation contract", () => {
  test("description uses 'use when' activation phrasing", () => {
    expect(description).toContain("use when");
  });

  for (const { prompt, terms } of cases) {
    test(`"${prompt}" → description surfaces ${terms.join(", ")}`, () => {
      for (const term of terms) {
        expect(description).toContain(term.toLowerCase());
      }
    });
  }
});
