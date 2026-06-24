import { describe, expect, test } from "bun:test";
import { component, html } from "../index.js";
import { ComponentStack, Components } from "../src/components.js";
import { FieldStep, Path, SeqStep } from "../src/path.js";
import { buildExampleRequestHandlers, Example, Section, Storybook } from "../src/storybook.js";
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
    t.pushBubble(new Path([]), "sectionSelected", [t.state.val.sections.get(index)]);
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
