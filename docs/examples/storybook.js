// The docs storybook is now CONTENT only — the engine (Storybook/Section/Example
// + aggregation) lives in the shipped tutuca/storybook library. This file picks
// which example modules to aggregate and adds the self-referential "Inception"
// demo. In dev the import map (docs/storybook.html) maps tutuca/storybook to
// ../storybook.js and tutuca to ../dev.js.
import { buildStorybook, Example, Section, Storybook } from "tutuca/storybook";
import * as composabilityMod from "./composability.js";
import * as counterMod from "./counter.js";
import * as dndMod from "./dnd-example.js";
import * as jsonMod from "./json.js";
import * as personalSiteMod from "./personal-site.js";
import * as todoMod from "./todo.js";
import * as treeMod from "./tree.js";
import * as visualWasmMod from "./visual-wasm.js";

const SECTION_MODULES = [
  counterMod,
  todoMod,
  dndMod,
  jsonMod,
  personalSiteMod,
  treeMod,
  visualWasmMod,
  composabilityMod,
];

// The modules this storybook aggregates (consumed by mountStorybook in the
// bootstrap, and by buildStorybook below).
export function getModules() {
  return SECTION_MODULES;
}

export function getComponents() {
  return buildStorybook(SECTION_MODULES).components;
}

export function getMacros() {
  return buildStorybook(SECTION_MODULES).macros;
}

export function getRequestHandlers() {
  return buildStorybook(SECTION_MODULES).requestHandlers;
}

export function getRoot() {
  const sections = SECTION_MODULES.map((mod) => mod.getExamples())
    .map((data) => Section.Class.fromData(data))
    .sort((a, b) => a.title.localeCompare(b.title));
  const storyBookSections = getExamples();
  storyBookSections.items.push({
    title: "Inception",
    description: "The outer storybook, as an example of itself 🐢️",
    value: Storybook.make({ sections }),
  });
  return Storybook.make({
    sections: [...sections, Section.Class.fromData(storyBookSections)],
  });
}

export function getExamples() {
  const counterSection = Section.Class.fromData(counterMod.getExamples());
  return {
    title: "Storybook",
    description: "The storybook itself, rendered as a section",
    items: [
      {
        title: "Storybook",
        description: "Storybook root with two sections",
        value: Storybook.make({
          sections: [counterSection, Section.Class.fromData(todoMod.getExamples())],
        }),
      },
      {
        title: "Single Section",
        description: "A standalone Section rendered by itself",
        value: counterSection,
      },
      {
        title: "Single Example",
        description: "A standalone Example card",
        value: Example.Class.fromData({
          title: "Example Title",
          description: "Example description",
          value: counterSection.items.first()?.item ?? null,
        }),
      },
    ],
  };
}
