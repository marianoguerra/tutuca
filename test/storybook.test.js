import { describe, expect, test } from "bun:test";
import { component, html } from "../index.js";
import { ComponentStack, Components } from "../src/components.js";
import { FieldStep, Path, SeqStep } from "../src/path.js";
import {
  buildExampleRequestHandlers,
  buildStorybook,
  Example,
  fuzzyMatch,
  Section,
  Storybook,
} from "../src/storybook/index.js";
import { rootDispatcher, Transactor } from "../src/transactor.js";

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

describe("per-example request mocks", () => {
  // A leaf component that issues requests, plus a container holding two examples so
  // both render at once under a single shared meta-handler registry.
  const Widget = component({ name: "Widget", fields: { loaded: "?" }, view: html`<i></i>` });
  const Book = component({
    name: "Book",
    fields: { a: null, b: null },
    view: html`<div><x render=".a"></x><x render=".b"></x></div>`,
  });

  function mount({ reals = {}, overrideNames = new Set() }, root) {
    const comps = new Components();
    const scope = new ComponentStack(comps);
    scope.registerComponents([Book, Example, Widget]);
    // Meta handlers live on the parent scope; each component's own scope chains up to it.
    scope.registerRequestHandlers(
      buildExampleRequestHandlers({ requestHandlers: reals, overrideNames }),
    );
    return new Transactor(comps, root);
  }

  const exWith = (handlers) => Example.make({ value: Widget.make({}), requestHandlers: handlers });
  // Inside Book: a is at .a, its Widget at .a.value; b at .b, Widget at .b.value.
  const widgetPath = (slot) => new Path([new FieldStep(slot), new FieldStep("value")]);

  test("two examples of the same component each get their own mock (per-instance)", async () => {
    const calls = [];
    const root = Book.make({
      a: exWith({
        load: async () => {
          calls.push("A");
          return "A";
        },
      }),
      b: exWith({
        load: async () => {
          calls.push("B");
          return "B";
        },
      }),
    });
    const t = mount({ overrideNames: new Set(["load"]) }, root);
    await t.pushRequest(widgetPath("a"), "load", []);
    await t.pushRequest(widgetPath("b"), "load", []);
    expect(calls).toEqual(["A", "B"]);
  });

  test("an example with no mock for the name falls back to the real handler", async () => {
    const calls = [];
    const root = Book.make({
      a: exWith({
        load: async () => {
          calls.push("mockA");
          return "A";
        },
      }),
      b: exWith({}), // no override
    });
    const reals = {
      load: async () => {
        calls.push("real");
        return "R";
      },
    };
    const t = mount({ reals, overrideNames: new Set(["load"]) }, root);
    await t.pushRequest(widgetPath("a"), "load", []);
    await t.pushRequest(widgetPath("b"), "load", []);
    expect(calls).toEqual(["mockA", "real"]);
  });

  test("the meta handler throws Request not found when neither override nor real exists", async () => {
    const handlers = buildExampleRequestHandlers({
      requestHandlers: {},
      overrideNames: new Set(["load"]),
    });
    const ctx = { walkPath() {} }; // walks nothing → no override
    await expect(handlers.load(ctx)).rejects.toThrow("Request not found: load");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle hooks: section navigation drives init/resume/suspend down to each
// example's component (`.value`) via its `on` config.
// ---------------------------------------------------------------------------

// A stand-in "component under test" that counts the lifecycle messages it gets.
const Probe = component({
  name: "Probe",
  fields: { init: 0, resume: 0, suspend: 0, last: null },
  receive: {
    onInit(arg, _ctx) {
      return this.setInit(this.init + 1).setLast(arg ?? null);
    },
    onResume(_ctx) {
      return this.setResume(this.resume + 1);
    },
    onSuspend(_ctx) {
      return this.setSuspend(this.suspend + 1);
    },
  },
  view: html`<div></div>`,
});

const LIFECYCLE_ON = {
  init: { send: [{ name: "onInit" }] },
  resume: { send: [{ name: "onResume" }] },
  suspend: { send: [{ name: "onSuspend" }] },
};

function probeBook(sectionCount = 2) {
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    sections.push(
      Section.Class.fromData({
        title: `S${i}`,
        items: [{ title: `E${i}`, value: Probe.make({}), on: LIFECYCLE_ON }],
      }),
    );
  }
  return Storybook.make({ sections });
}

function lifecycleTransactor(book) {
  const stack = new ComponentStack();
  stack.registerComponents([Storybook, Section, Example, Probe]);
  return new Transactor(stack.comps, book);
}

function runAll(t) {
  while (t.hasPendingTransactions) t.transactNext();
}

const probeAt = (book, section, item = 0) => book.sections.get(section).items.get(item).value;

describe("Storybook lifecycle: section -> example -> value cascade", () => {
  test("sending init to a section runs each example's on.init and marks it initialized", () => {
    const t = lifecycleTransactor(probeBook(1));
    rootDispatcher(t).sendAtPath(new Path([new SeqStep("sections", 0)]), "init", []);
    runAll(t);
    expect(t.state.val.sections.get(0).initialized).toBe(true);
    expect(probeAt(t.state.val, 0).init).toBe(1);
  });

  test("examples without `on` receive nothing on init (no error)", () => {
    const book = Storybook.make({
      sections: [
        Section.Class.fromData({ title: "S", items: [{ title: "E", value: Probe.make({}) }] }),
      ],
    });
    const t = lifecycleTransactor(book);
    rootDispatcher(t).sendAtPath(new Path([new SeqStep("sections", 0)]), "init", []);
    runAll(t);
    expect(probeAt(t.state.val, 0).init).toBe(0);
    expect(t.state.val.sections.get(0).initialized).toBe(true);
  });

  test("resume/suspend forward without flipping initialized", () => {
    const t = lifecycleTransactor(probeBook(1));
    const d = rootDispatcher(t);
    const sec0 = new Path([new SeqStep("sections", 0)]);
    d.sendAtPath(sec0, "resume", []);
    d.sendAtPath(sec0, "suspend", []);
    runAll(t);
    const p = probeAt(t.state.val, 0);
    expect([p.resume, p.suspend, p.init]).toEqual([1, 1, 0]);
    expect(t.state.val.sections.get(0).initialized).toBe(false);
  });
});

describe("Storybook lifecycle: section-switch transitions (bubble.sectionSelected)", () => {
  // Drives the real bubble.sectionSelected handler -> transitionSections. The
  // persistState request it issues 404s harmlessly (no handler registered here).
  function selectSection(t, index) {
    // sectionSelected bubbles the clicked entry's section id (a string).
    t.pushBubble(new Path([]), "sectionSelected", [t.state.val.sections.get(index).id]);
    runAll(t);
  }

  test("first select inits only the chosen section; switch suspends old + inits new; return resumes", () => {
    const t = lifecycleTransactor(probeBook(2));

    selectSection(t, 0); // first display of S0
    let s = t.state.val;
    expect(probeAt(s, 0).init).toBe(1);
    expect(probeAt(s, 1).init).toBe(0); // S1 untouched

    selectSection(t, 1); // away from S0, first display of S1
    s = t.state.val;
    expect(probeAt(s, 0).suspend).toBe(1);
    expect(probeAt(s, 1).init).toBe(1);

    selectSection(t, 0); // back to S0 (already initialized -> resume)
    s = t.state.val;
    expect(probeAt(s, 0).resume).toBe(1);
    expect(probeAt(s, 0).init).toBe(1); // not re-initialized
    expect(probeAt(s, 1).suspend).toBe(1);
  });

  test("re-selecting the already-current section is a no-op", () => {
    const t = lifecycleTransactor(probeBook(2));
    selectSection(t, 0);
    selectSection(t, 0); // same section again
    const p = probeAt(t.state.val, 0);
    expect([p.init, p.resume, p.suspend]).toEqual([1, 0, 0]);
  });
});

// A fake dev/story module: just the getExamples() the aggregator reads.
function mod(...rawSections) {
  return { getExamples: () => (rawSections.length === 1 ? rawSections[0] : rawSections) };
}
// Flatten the sidebar tree into [groupName, [entryTitles]] for terse assertions.
function shape(book) {
  return book.sidebar.toArray().map((g) => [g.name, g.rows.toArray().map((e) => e.title)]);
}
const entryTitles = (g) => g.rows.toArray().map((e) => e.title);
const visibleTitles = (g) =>
  g.rows
    .toArray()
    .filter((e) => e.visible)
    .map((e) => e.title);

describe("Storybook retained sidebar", () => {
  test("ungrouped sections each become a headerless singleton, alphabetical (flat compat)", () => {
    const { root } = buildStorybook([
      mod({ title: "Todo", items: [{ title: "x", value: 1 }] }),
      mod({ title: "Counter", items: [{ title: "y", value: 2 }] }),
    ]);
    expect(shape(root)).toEqual([
      ["", ["Counter"]],
      ["", ["Todo"]],
    ]);
  });

  test("sections sharing a group cluster under one entry, across modules", () => {
    const { root } = buildStorybook([
      mod({ group: "Margaui", title: "Controls", items: [{ title: "a", value: 1 }] }),
      mod({ group: "Margaui", title: "Layout", items: [{ title: "b", value: 2 }] }),
    ]);
    expect(shape(root)).toEqual([["Margaui", ["Controls", "Layout"]]]);
  });

  test("groups and loose sections interleave alphabetically by display key", () => {
    const { root } = buildStorybook([
      mod({ title: "Zebra", items: [{ title: "a", value: 1 }] }),
      mod({ group: "Margaui", title: "Controls", items: [{ title: "b", value: 2 }] }),
      mod({ title: "Apple", items: [{ title: "c", value: 3 }] }),
    ]);
    expect(shape(root).map(([name, titles]) => name || titles[0])).toEqual([
      "Apple",
      "Margaui",
      "Zebra",
    ]);
  });

  test("a non-string `group` is ignored at runtime (rendered ungrouped)", () => {
    const { root } = buildStorybook([
      mod({ group: ["Margaui"], title: "Controls", items: [{ title: "a", value: 1 }] }),
    ]);
    expect(root.sidebar.get(0).name).toBe("");
  });

  test("clicking a sidebar entry highlights it (and only it) by section id", () => {
    const { root } = buildStorybook([
      mod({ title: "Counter", items: [{ title: "y", value: 1 }] }),
      mod({ title: "Todo", items: [{ title: "x", value: 2 }] }),
    ]);
    const sel = root.markSidebarSelected("todo");
    const selected = sel.sidebar
      .toArray()
      .flatMap((g) => g.rows.toArray())
      .filter((e) => e.selected)
      .map((e) => e.sectionId);
    expect(selected).toEqual(["todo"]);
  });

  test("collapse hides a group's entries in place; intent persists; filter force-expands", () => {
    const { root } = buildStorybook([
      mod({ group: "Margaui", title: "Controls", items: [{ title: "a", value: 1 }] }),
      mod({ group: "Margaui", title: "Layout", items: [{ title: "b", value: 2 }] }),
    ]);
    // Collapse (no filter): the group stays but its entries go invisible.
    const collapsed = root.toggleSidebarGroup("Margaui");
    expect(collapsed.sidebar.get(0).collapsed).toBe(true);
    expect(visibleTitles(collapsed.sidebar.get(0))).toEqual([]);
    expect(entryTitles(collapsed.sidebar.get(0))).toEqual(["Controls", "Layout"]); // still present

    // Filter force-expands past the collapse: only the match is visible, collapse kept.
    const filtered = collapsed.setFilter("layout").applyFilterToSidebar("layout");
    expect(filtered.sidebar.get(0).collapsed).toBe(true);
    expect(visibleTitles(filtered.sidebar.get(0))).toEqual(["Layout"]);

    // Clearing the filter restores the remembered collapse.
    const cleared = filtered.setFilter("").applyFilterToSidebar("");
    expect(visibleTitles(cleared.sidebar.get(0))).toEqual([]);
  });

  test("filtering to zero matches hides the group (kept in tree, visible=false)", () => {
    const { root } = buildStorybook([
      mod({ group: "Margaui", title: "Controls", items: [{ title: "a", value: 1 }] }),
    ]);
    const filtered = root.setFilter("nomatch").applyFilterToSidebar("nomatch");
    expect(filtered.sidebar.size).toBe(1);
    expect(filtered.sidebar.get(0).visible).toBe(false);
  });
});

describe("fuzzyMatch permissiveness", () => {
  test("empty query matches everything", () => {
    expect(fuzzyMatch("", "anything at all")).toBe(true);
  });

  test("substring and contiguous matches are accepted (case-insensitive)", () => {
    expect(fuzzyMatch("layout", "Layoutx (join / stack / mask)")).toBe(true);
    expect(fuzzyMatch("tab", "Data table")).toBe(true);
    expect(fuzzyMatch("JSON", "JsonViewer")).toBe(true);
  });

  test("near-contiguous matches within the gap budget still pass", () => {
    // "tabs" as a subsequence of "ta_bs" — one gap, within budget for len 4.
    expect(fuzzyMatch("tabs", "ta bs")).toBe(true);
  });

  test("a long query scattered across an unrelated string is rejected", () => {
    expect(fuzzyMatch("layout", "Data display (table, list, timeline, countdown)")).toBe(false);
    expect(fuzzyMatch("selection", "Each card shows a live preview and an editor")).toBe(false);
    expect(fuzzyMatch("countdown", "Controls (form & action builders)")).toBe(false);
  });

  test("a query whose chars are not all present in order is rejected", () => {
    expect(fuzzyMatch("xyz", "Layout")).toBe(false);
  });
});
