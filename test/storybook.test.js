import { describe, expect, test } from "bun:test";
import { Section, Storybook } from "../src/storybook.js";

// Two sections, each with a couple of examples, mirroring buildStorybook's shape.
function makeBook() {
  const sections = [
    {
      title: "Counter",
      description: "counters",
      items: [
        { title: "Basic", value: 1 },
        { title: "Stepped", value: 2 },
      ],
    },
    {
      title: "Todo",
      description: "todos",
      items: [
        { title: "Empty", value: 3 },
        { title: "Filled", value: 4 },
      ],
    },
  ].map((s) => Section.Class.fromData(s));
  return Storybook.make({ sections });
}

// response.loadState is thin orchestration over these public methods; replicate
// its exact chain so the restore behavior is covered without the transactor.
function restore(book, state) {
  const next = book
    .selectSectionWithId(state.section)
    .setFilter(state.sectionFilter ?? "")
    .setSelectedSectionFilter(state.exampleFilter ?? "");
  return state.example
    ? next.focusExampleByIds(state.section, state.example)
    : next.setSectionId(null).setExampleId(null).setFocusExample(null);
}

describe("Storybook URL state", () => {
  test("toUrlState reflects current state with empty defaults", () => {
    expect(makeBook().toUrlState()).toEqual({
      section: "counter",
      example: "",
      sectionFilter: "",
      exampleFilter: "",
    });
  });

  test("toUrlState applies overrides over current state", () => {
    const book = makeBook().setFilter("co");
    expect(book.toUrlState({ section: "todo", example: "filled" })).toEqual({
      section: "todo",
      example: "filled",
      sectionFilter: "co",
      exampleFilter: "",
    });
  });

  test("setSelectedSectionFilter only touches the selected section", () => {
    const book = makeBook().selectSectionWithId("todo").setSelectedSectionFilter("fi");
    expect(book.sections.get(book.selectedSectionIndex).filter).toBe("fi");
    expect(book.sections.find((s) => s.id === "counter").filter).toBe("");
  });

  test("restore selects section, both filters, and focus", () => {
    const book = restore(makeBook(), {
      section: "todo",
      example: "filled",
      sectionFilter: "to",
      exampleFilter: "fi",
    });
    expect(book.selectedSectionIndex).toBe(1);
    expect(book.filter).toBe("to");
    expect(book.sections.get(1).filter).toBe("fi");
    expect(book.sectionId).toBe("todo");
    expect(book.exampleId).toBe("filled");
    expect(book.focusExample).toBe(4);
  });

  test("restore without example clears focus (Back/Forward un-focus)", () => {
    const focused = restore(makeBook(), { section: "todo", example: "filled" });
    expect(focused.focusExample).toBe(4);
    const browsed = restore(focused, { section: "todo", example: null });
    expect(browsed.sectionId).toBe(null);
    expect(browsed.exampleId).toBe(null);
    expect(browsed.focusExample).toBe(null);
  });

  test("restore with unknown section clamps to the first section", () => {
    const book = restore(makeBook(), { section: "nope" });
    expect(book.selectedSectionIndex).toBe(0);
  });
});
