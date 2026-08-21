// Regression tests for `shadowCheckComponent` (the dev build's no-mutation
// lint entry, shared by the storybook lint tab and the docs playground).
//
// It used to build its throwaway component with
// `Object.create(Comp); shadow.views = shadowViews` — a plain ASSIGNMENT. Once
// component() was unified with the generated Class (Component.fromSpec), the
// Class exposes every metadata key through prototype accessors whose setter
// writes THROUGH to the live component record. The assignment walked the chain,
// fired the `views` setter, and replaced the real component's compiled Views
// with context-less `{name, ctx, rawView}` stand-ins — so the next render died
// with `TypeError: view.render is not a function`. In the playground this hit
// exactly when an answered intent re-rendered after the inspector had linted.
import { expect, test } from "vitest";
import { shadowCheckComponent } from "../dev.js";
import { component, html } from "../index.js";
import { ComponentStack } from "../src/components.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();
// shadowCheckComponent builds its LintParseContext from the browser globals
// (`document`, `Text`, `Comment`); jsdom only exposes them per-window.
for (const k of ["Text", "Comment", "Node"])
  if (globalThis[k] === undefined) globalThis[k] = document.defaultView[k];

function makeComp() {
  const Comp = component({
    name: "ShadowLintTarget",
    fields: { n: 0 },
    view: html`<p class="main" @text=".n"></p>`,
    views: { alt: html`<i></i>` },
  });
  Comp.scope = new ComponentStack();
  Comp.compile(HeadlessParseContext);
  return Comp;
}

test("shadowCheckComponent leaves the live views untouched", () => {
  const Comp = makeComp();
  const main = Comp.views.main;
  const alt = Comp.views.alt;

  expect(shadowCheckComponent(Comp)).toEqual([]);

  // The real record still holds the compiled Views (identity + renderability).
  expect(Comp.views.main).toBe(main);
  expect(Comp.views.alt).toBe(alt);
  expect(typeof main.render).toBe("function");
});

test("a component stays renderable after being shadow-linted", async () => {
  const Comp = makeComp();

  const { container, cleanup } = renderToHTMLNode(
    document,
    [Comp],
    null,
    Comp.make({ n: 7 }),
    HeadlessParseContext,
    { noCache: true },
  );
  try {
    shadowCheckComponent(Comp);
    expect(container.querySelector(".main")?.textContent).toBe("7");
  } finally {
    cleanup();
  }
});

// End-to-end over the failing shape: lint while an answered intent is in flight,
// like the docs playground does (buildInspectorViews runs between sendAtRoot and
// the transaction batch that applies the answer).
test("personal-site example survives linting before its init answer lands", async () => {
  const { getComponents, getRoot, getIntentHandlers } = await import(
    "../docs/examples/personal-site.js"
  );
  const handlers = getIntentHandlers();
  // Offline-safe stand-in for the module's fetch-based handler.
  handlers.loadData = async () => [
    {
      title: "Sample Project",
      description: "An example entry",
      startYear: 2020,
      endYear: 2024,
      role: "Author",
      featured: true,
      url: "#",
      categories: ["Web", "AI"],
    },
  ];

  const comps = getComponents();
  const { container, app, cleanup } = renderToHTMLNode(
    document,
    comps,
    null,
    getRoot(),
    HeadlessParseContext,
    { noCache: true, intentHandlers: handlers },
  );
  try {
    // The inspector lints every registered component.
    for (const Comp of comps) shadowCheckComponent(Comp);
    app.sendAtRoot("init");
    await app.transactor.settle();
    expect(container.textContent).toContain("Sample Project");
  } finally {
    cleanup();
  }
});
