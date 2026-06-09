import { describe, expect, test } from "bun:test";
import { component, html, IMap, List, SEQ_INFO } from "../index.js";
import { renderToHTML, renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// Mirrors docs/examples/custom-collection.js (which imports the dist build):
// a minimal keyed list registering a SEQ_INFO walker so @each can iterate it.
class KeyedList {
  constructor(items = IMap(), order = List()) {
    this.items = items;
    this.order = order;
  }
  set(k, v) {
    const order = this.items.has(k) ? this.order : this.order.push(k);
    return new KeyedList(this.items.set(k, v), order);
  }
  get(k, dval = null) {
    return this.items.get(k, dval);
  }
  delete(k) {
    if (!this.items.has(k)) return this;
    return new KeyedList(this.items.delete(k), this.order.delete(this.order.indexOf(k)));
  }
  get size() {
    return this.items.size;
  }
}
KeyedList.prototype[SEQ_INFO] = (seq, visit, start, end) => {
  for (const k of seq.order.slice(start, end)) visit(k, seq.items.get(k), "sk");
};

const Song = component({
  name: "Song",
  fields: { title: "" },
  view: html`<span @text=".title"></span>`,
});

const Playlist = component({
  name: "Playlist",
  fields: { songs: new KeyedList() },
  methods: {
    removeSong(key) {
      return this.setSongs(this.songs.delete(key));
    },
  },
  alter: {
    window() {
      return { start: 1, end: 2 };
    },
  },
  view: html`<ul>
    <li @each=".songs">
      <x render-it></x>
      <button :data-key="@key" @on.click="$removeSong @key">remove</button>
    </li>
  </ul>`,
  views: {
    sliced: html`<ul>
      <li @each=".songs" @loop-with="window"><x render-it></x></li>
    </ul>`,
  },
});

const makeRoot = () =>
  Playlist.make({
    songs: new KeyedList()
      .set("intro", Song.make({ title: "Intro" }))
      .set("middle", Song.make({ title: "Middle Eight" }))
      .set("outro", Song.make({ title: "Outro" })),
  });

describe("custom collection via SEQ_INFO", () => {
  test("@each renders entries in insertion order", () => {
    const out = renderToHTML(document, [Playlist, Song], null, makeRoot(), HeadlessParseContext);
    expect(out.indexOf("Intro")).toBeGreaterThan(-1);
    expect(out.indexOf("Intro")).toBeLessThan(out.indexOf("Middle Eight"));
    expect(out.indexOf("Middle Eight")).toBeLessThan(out.indexOf("Outro"));
  });

  test("walker passes the entry key as @key and data attrs", () => {
    const { container, cleanup } = renderToHTMLNode(
      document,
      [Playlist, Song],
      null,
      makeRoot(),
      HeadlessParseContext,
    );
    const keys = [...container.querySelectorAll("button")].map((b) => b.dataset.key);
    expect(keys).toEqual(["intro", "middle", "outro"]);
    cleanup();
  });

  // Pins the "sk" meta-key contract: with a wrong attr name (e.g. "data-sk")
  // path reconstruction finds no key and the remove handler gets undefined.
  test("a click inside @each resolves its entry key through the event path", () => {
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Playlist, Song],
      null,
      makeRoot(),
      HeadlessParseContext,
    );
    expect(app.state.val.songs.size).toBe(3);
    container.querySelector('[data-key="middle"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.songs.size).toBe(2);
    expect(app.state.val.songs.get("middle")).toBe(null);
    expect(app.state.val.songs.get("intro")).not.toBe(null);
    cleanup();
  });

  test("walker honors the @loop-with slice range", () => {
    const Library = component({
      name: "Library",
      fields: { playlist: null },
      view: html`<div><x render=".playlist" as="sliced"></x></div>`,
    });
    const root = Library.make({ playlist: makeRoot() });
    const out = renderToHTML(document, [Library, Playlist, Song], null, root, HeadlessParseContext);
    expect(out).toContain("Middle Eight");
    expect(out).not.toContain("Intro");
    expect(out).not.toContain("Outro");
  });
});
