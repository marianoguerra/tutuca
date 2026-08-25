// A view root that renders nothing yields a literal null (ShowNode/HideNode,
// and Renderer._rValComp for a component whose view root is hidden). Inside a
// tree that null is dropped by addChild, but at the render ROOT there is no
// parent to drop it into: vdom's render() has to empty the container instead
// of dereferencing it. It reaches the root whenever the component under test
// IS the app root — which is what `tutuca render` does for every example.
import { describe, expect, test } from "vitest";
import { component, html } from "../index.js";
import { renderToHTML, renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

const Badge = component({
  name: "Badge",
  fields: { visible: false, label: "" },
  view: html`<span @show=".visible" @text=".label"></span>`,
});

const Host = component({
  name: "Host",
  fields: { badge: null },
  view: html`<x render=".badge"></x>`,
});

const render = (comps, value) => renderToHTML(document, comps, null, value, HeadlessParseContext);

describe("a render root that renders nothing", () => {
  test("<x render> of a component whose root is @show-hidden renders empty", () => {
    expect(render([Badge, Host], Host.make({ badge: Badge.make({}) }))).toBe("");
  });

  test("the root component's own @show-hidden root renders empty", () => {
    expect(render([Badge], Badge.make({}))).toBe("");
  });

  test("the root component's own @hide-hidden root renders empty", () => {
    const Gone = component({
      name: "Gone",
      fields: { gone: true },
      view: html`<span @hide=".gone">gone</span>`,
    });
    expect(render([Gone], Gone.make({}))).toBe("");
  });

  test("<x render> of a field with no component renders empty", () => {
    expect(render([Badge, Host], Host.make({}))).toBe("");
  });

  // The empty render must not poison the render state: the next state that
  // does produce DOM has to rebuild the whole tree, and the one after it has
  // to morph normally on top of it.
  test("a hidden root recovers when it becomes visible again", () => {
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Badge, Host],
      null,
      Host.make({ badge: Badge.make({ visible: true, label: "hi" }) }),
      HeadlessParseContext,
    );
    try {
      expect(container.textContent).toBe("hi");
      app.state.set(Host.make({ badge: Badge.make({ visible: false }) }));
      expect(container.innerHTML).toBe("");
      app.state.set(Host.make({ badge: Badge.make({ visible: true, label: "back" }) }));
      expect(container.textContent).toBe("back");
      app.state.set(Host.make({ badge: Badge.make({ visible: true, label: "again" }) }));
      expect(container.textContent).toBe("again");
    } finally {
      cleanup();
    }
  });

  test("a root hidden on the FIRST render still mounts when shown later", () => {
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Badge, Host],
      null,
      Host.make({ badge: Badge.make({}) }),
      HeadlessParseContext,
    );
    try {
      expect(container.innerHTML).toBe("");
      app.state.set(Host.make({ badge: Badge.make({ visible: true, label: "on" }) }));
      expect(container.textContent).toBe("on");
    } finally {
      cleanup();
    }
  });
});
