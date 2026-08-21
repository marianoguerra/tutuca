// 05 — INTENTS ON THE `lex` LEG: getIntentHandlers (the module's REAL handlers) +
// per-example `intentHandlers` mocks. Four idioms, side by side:
//   - fixture        — async returns canned data
//   - error          — async throws (exercises the error path)
//   - loading-forever — returns a promise that never resolves
//   - no mock        — falls back to the module's real getIntentHandlers()
//
// Resolution: the storybook registers ONE meta-handler per intent name; on dispatch
// it walks the issuing component's path to the nearest example carrying a mock for
// that name (nearest example wins), else the module's real handler.
//
// Each card loads on first display via `on: { init: { send: ["load"] } }` (so it
// works on a runtime with lifecycle hooks), and also has a Reload button that
// works everywhere.
import { component, html } from "tutuca";
import { delay, SAMPLE_ROWS } from "./_shared.js";

const DataList = component({
  name: "DataList",
  fields: { rows: [], status: "idle" }, // idle | loading | loaded | error
  methods: {
    // Receive handlers invoked from events get the draft first and `ctx` last.

    isLoading() {
      return this.status === "loading";
    },
    isLoaded() {
      return this.status === "loaded";
    },
    isError() {
      return this.status === "error";
    },
  },
  receive: {
    reload(draft, ctx) {
      ctx.intent("loadRows", [], { route: ["lex"] });
      draft.status = "loading";
    },

    // The two outcomes of `loadRows`, each with its own name and its own shape. One
    // combined `(res, err)` arm would hand both to every call and leave the body to work
    // out which slot was filled — which is exactly how a split arm read the wrong one.
    loadRowsOk(draft, res) {
      draft.status = "loaded";
      draft.rows = res;
    },
    loadRowsError(draft) {
      draft.status = "error";
    },
    // Lifecycle `on.init.send` targets this; reuse the reload method.
    load(draft, ctx) {
      ctx.intent("loadRows", [], { route: ["lex"] });
      draft.status = "loading";
    },
  },
  view: html`<div class="flex flex-col gap-2 max-w-sm">
    <div class="flex items-center gap-2">
      <button class="btn btn-sm btn-primary" @on.click="reload">Reload</button>
      <span class="text-sm opacity-70">status: <code @text=".status"></code></span>
    </div>
    <div class="alert alert-info alert-soft" @show="$isLoading">Loading…</div>
    <div class="alert alert-error alert-soft" @show="$isError">Request failed</div>
    <ul class="menu bg-base-200 rounded w-full" @show="$isLoaded">
      <li @each=".rows">
        <a><x text="@value"></x></a>
      </li>
    </ul>
  </div>`,
});

export function getComponents() {
  return [DataList];
}

export function getRoot() {
  return DataList.make({});
}

// The module's REAL handler — used by any example that doesn't mock `loadRows`.
export function getIntentHandlers() {
  return {
    loadRows: async () => delay(500, SAMPLE_ROWS),
  };
}

const autoLoad = { init: { send: [{ name: "load", args: [] }] } };

export function getExamples() {
  return {
    group: "Authoring · Behavior",
    title: "Requests",
    description: "Real getIntentHandlers + per-example mocks (fixture / error / loading / real)",
    items: [
      {
        title: "Real handler",
        description: "no mock → module's getIntentHandlers (500ms then rows)",
        value: DataList.make(),
        on: autoLoad,
      },
      {
        title: "Mocked fixture",
        description: "per-example mock returns canned rows instantly",
        value: DataList.make(),
        on: autoLoad,
        intentHandlers: { loadRows: async () => ["mock-one", "mock-two", "mock-three"] },
      },
      {
        title: "Mocked error",
        description: "per-example mock throws → error path",
        value: DataList.make(),
        on: autoLoad,
        intentHandlers: {
          loadRows: async () => {
            throw new Error("mocked failure");
          },
        },
      },
      {
        title: "Loading forever",
        description: "per-example mock never resolves → perpetual loading",
        value: DataList.make(),
        on: autoLoad,
        intentHandlers: { loadRows: () => new Promise(() => {}) },
      },
      {
        title: "No auto-load (click Reload)",
        description: "no `on`; click Reload to hit the real handler",
        value: DataList.make(),
      },
    ],
  };
}
