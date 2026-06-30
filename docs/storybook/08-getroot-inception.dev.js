// 08 — getRoot + "Inception".
//
// getRoot() returns standalone root state for a module — what `tutuca render` shows
// and what a module is when run on its own. Here the module's root literally IS a
// Storybook, demonstrating that the engine's own components (Storybook / Section /
// Example) are ordinary components you can instantiate and render anywhere — even
// inside one of its own example cards ("Inception" 🐢).
import { component, html } from "tutuca";
import { Section, Storybook } from "tutuca/storybook";

const Note = component({
  name: "Note",
  fields: { text: "note" },
  view: html`<div class="badge badge-soft badge-lg" @text=".text"></div>`,
});

// Build a couple of inner sections out of Note instances.
function demoSections() {
  return [
    Section.Class.fromData({
      title: "Inner A",
      description: "first inner section",
      items: [
        { title: "note 1", value: Note.make({ text: "alpha" }) },
        { title: "note 2", value: Note.make({ text: "beta" }) },
      ],
    }),
    Section.Class.fromData({
      title: "Inner B",
      description: "second inner section",
      items: [{ title: "note 3", value: Note.make({ text: "gamma" }) }],
    }),
  ];
}

// Only Note is ours; the engine always registers Storybook/Section/Example itself.
export function getComponents() {
  return [Note];
}

// A module whose standalone root is an entire Storybook.
export function getRoot() {
  // withSections derives the sidebar tree from the sections — a raw `Storybook.make`
  // leaves it empty (buildStorybook is the usual builder).
  return Storybook.Class.withSections(demoSections());
}

export function getExamples() {
  return {
    group: "Authoring · Roots & Tests",
    title: "getRoot & Inception",
    description: "getRoot returns standalone root state; the engine renders itself",
    items: [
      {
        title: "Inception 🐢",
        description: "a whole Storybook rendered inside one example card",
        value: Storybook.Class.withSections(demoSections()),
      },
      {
        title: "A standalone Section",
        description: "the Section component rendered on its own",
        value: demoSections()[0],
      },
    ],
  };
}
