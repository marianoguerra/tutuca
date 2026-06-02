import { component, html } from "tutuca";

// A dynamic variable (`*name`) used as a component-render target.
//
// `Workspace` *produces* the dynamic `active` (its `.sheet` field) and renders a
// deep tree: Workspace -> Panel -> Toolbar. `Toolbar`, far from the producer,
// *consumes* `active` and does `<x render="*active">` to render the Sheet.
//
// The rendered Sheet's data physically lives at `Workspace.sheet`, NOT under
// `Toolbar`. When you edit the title inside the dynamically-rendered Sheet, the
// event path is *expanded* during reconstruction (it walks Workspace -> Panel ->
// Toolbar) but *teleported* for the transaction: the mutation skips the
// intermediate components and lands on `Workspace.sheet`. The proof: the title
// echoed at the Workspace level (top) updates in lock-step.

const Sheet = component({
  name: "Sheet",
  fields: { title: "untitled" },
  view: html`<div class="card bg-base-200 p-3 gap-2">
    <span class="text-xs opacity-60">Sheet (rendered via *active)</span>
    <input
      class="input input-bordered"
      :value=".title"
      @on.input="$setTitle value"
      placeholder="Sheet title"
    />
  </div>`,
});

const Toolbar = component({
  name: "Toolbar",
  fields: {},
  // Consumer: forwards to Workspace's `active` dynamic. The default is only used
  // when no producer is in scope.
  lookup: { active: { for: "Workspace.active", default: ".missing" } },
  view: html`<div class="border border-dashed border-warning rounded p-3 gap-2">
    <span class="text-xs opacity-60">Toolbar (consumer)</span>
    <x render="*active"></x>
  </div>`,
});

const Panel = component({
  name: "Panel",
  fields: { toolbar: null },
  view: html`<div class="border border-dashed border-info rounded p-3 gap-2">
    <span class="text-xs opacity-60">Panel (intermediate)</span>
    <x render=".toolbar"></x>
  </div>`,
});

const Workspace = component({
  name: "Workspace",
  fields: { sheet: null, panel: null },
  // Producer: exposes its `.sheet` field as the dynamic `active`.
  provide: { active: ".sheet" },
  methods: {
    sheetTitle() {
      return this.sheet?.title ?? "";
    },
  },
  view: html`<div class="flex flex-col gap-3 p-3">
    <div class="alert">
      <span>Workspace.sheet.title = <b @text="$sheetTitle"></b></span>
    </div>
    <x render=".panel"></x>
  </div>`,
});

function makeRoot(title = "untitled") {
  return Workspace.make({
    sheet: Sheet.make({ title }),
    panel: Panel.make({ toolbar: Toolbar.make() }),
  });
}

export function getComponents() {
  return [Workspace, Panel, Toolbar, Sheet];
}

export function getRoot() {
  return makeRoot();
}

export function getExamples() {
  return {
    title: "Dynamic Variable in a Path",
    description:
      "A dynamic variable used as a `<x render>` target. Editing the title in the " +
      "dynamically-rendered Sheet mutates the producer's data (Workspace.sheet), " +
      "skipping the intermediate Panel/Toolbar components in the transaction path.",
    items: [
      { title: "Default", description: "Edit the title and watch the top echo", value: makeRoot() },
      { title: "Named sheet", description: "Starts with a title", value: makeRoot("design-notes") },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Sheet, () => {
    test("$setTitle updates the title", () => {
      const next = Sheet.make({ title: "a" }).setTitle("b");
      expect(next.title).toBe("b");
    });
  });
}
