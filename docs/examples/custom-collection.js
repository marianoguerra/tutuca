import { component, html, SEQ_INFO } from "tutuca";
import { immerable, produce } from "tutuca/immer";

// A minimal keyed collection that Immer can draft. Values live in a native Map
// and keys in a native Array, preserving insertion order.
export class KeyedList {
  static [immerable] = true;

  constructor(items = new Map(), order = []) {
    this.items = items;
    this.order = order;
  }
  set(k, v) {
    if (!this.items.has(k)) this.order.push(k);
    this.items.set(k, v);
    return this;
  }
  get(k, dval = null) {
    return this.items.has(k) ? this.items.get(k) : dval;
  }
  delete(k) {
    if (!this.items.has(k)) return this;
    this.items.delete(k);
    this.order.splice(this.order.indexOf(k), 1);
    return this;
  }
  get size() {
    return this.items.size;
  }
}

// To make `@each` iterate a custom collection, install a `SEQ_INFO` walker on
// its prototype. `SEQ_INFO` is `Symbol.for("tutuca.seqInfo")`, so the same
// identity is shared across module graphs; the renderer reads `seq[SEQ_INFO]`
// directly, which is why the walker goes on the prototype, not as a static.
//
// The third `visit` arg must be `"sk"` (keyed) or `"si"` (indexed): it is the
// meta key event-path reconstruction reads to resolve an event back to its
// entry. `start`/`end` are an optional `[start, end)` slice from `@loop-with`
// with Array.slice semantics.
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
  fields: {
    // No field-type registration is needed: custom values use the generic field.
    songs: new KeyedList(),
  },
  receive: {
    removeSong(draft, key) {
      draft.songs.delete(key);
    },
  },
  view: html`<ul class="flex flex-col gap-1">
    <li @each=".songs" class="flex gap-2 items-center">
      <x render-it></x>
      <!-- @key is the entry's KeyedList key, resolved through the walker -->
      <button class="btn btn-xs" @on.click="removeSong @key">remove</button>
    </li>
  </ul>`,
});

const SONGS = new KeyedList()
  .set("intro", Song.make({ title: "Intro" }))
  .set("middle", Song.make({ title: "Middle Eight" }))
  .set("outro", Song.make({ title: "Outro" }));

export function getComponents() {
  return [Playlist, Song];
}

export function getRoot() {
  return Playlist.make({ songs: SONGS });
}

export function getExamples() {
  return {
    title: "Custom Collection",
    description: "@each over a custom keyed collection registered via SEQ_INFO",
    items: [
      {
        title: "Playlist",
        description:
          "Entries iterate in insertion order; each remove button resolves @key through the walker",
        value: getRoot(),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(Playlist, () => {
    test("the SEQ_INFO walker visits entries in order with their keys", () => {
      const visited = [];
      SONGS[SEQ_INFO](SONGS, (k, v, attr) => visited.push([k, v.title, attr]));
      expect(visited).toEqual([
        ["intro", "Intro", "sk"],
        ["middle", "Middle Eight", "sk"],
        ["outro", "Outro", "sk"],
      ]);
    });

    test("the walker honors a @loop-with slice range", () => {
      const visited = [];
      SONGS[SEQ_INFO](SONGS, (k) => visited.push(k), 1, 2);
      expect(visited).toEqual(["middle"]);
    });

    test("removeSong drops the entry by key", () => {
      const c = Playlist.make({ songs: SONGS });
      const after = produce(c, (draft) => Playlist.receive.removeSong.call(c, draft, "middle"));
      expect(after.songs.size).toBe(2);
      expect(after.songs.get("middle")).toBe(null);
    });
  });
}
