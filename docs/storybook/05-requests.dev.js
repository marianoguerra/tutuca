// 05 — REQUESTS: getRequestHandlers (the module's REAL handlers) + per-example
// `requestHandlers` mocks. Four idioms, side by side:
//   - fixture        — async returns canned data
//   - error          — async throws (exercises the error path)
//   - loading-forever — returns a promise that never resolves
//   - no mock        — falls back to the module's real getRequestHandlers()
//
// Resolution: the storybook registers ONE meta-handler per request name; on
// dispatch it walks the issuing component's path to the nearest example carrying a
// mock for that name (nearest example wins), else the module's real handler.
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
    // Methods invoked from events receive `ctx` as the last argument.
    reload(ctx) {
      ctx.request("loadRows", []);
      return this.setStatus("loading");
    },
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
    // Lifecycle `on.init.send` targets this; reuse the reload method.
    load(ctx) {
      return this.reload(ctx);
    },
  },
  response: {
    loadRows(res, err) {
      return err ? this.setStatus("error") : this.setStatus("loaded").setRows(res);
    },
  },
  view: html`<div class="flex flex-col gap-2 max-w-sm">
    <div class="flex items-center gap-2">
      <button class="btn btn-sm btn-primary" @on.click="$reload">Reload</button>
      <span class="text-sm opacity-70">status: <code @text=".status"></code></span>
    </div>
    <div class="alert alert-info alert-soft" @show="$isLoading">Loading…</div>
    <div class="alert alert-error alert-soft" @show="$isError">Request failed</div>
    <ul class="menu bg-base-200 rounded w-full" @show="$isLoaded">
      <li @each=".rows"><a><x text="@value"></x></a></li>
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
export function getRequestHandlers() {
  return {
    loadRows: async () => delay(500, SAMPLE_ROWS),
  };
}

const autoLoad = { init: { send: [{ name: "load", args: [] }] } };

export function getExamples() {
  return {
    title: "05 · Requests",
    description: "Real getRequestHandlers + per-example mocks (fixture / error / loading / real)",
    items: [
      {
        title: "Real handler",
        description: "no mock → module's getRequestHandlers (500ms then rows)",
        value: DataList.make(),
        on: autoLoad,
      },
      {
        title: "Mocked fixture",
        description: "per-example mock returns canned rows instantly",
        value: DataList.make(),
        on: autoLoad,
        requestHandlers: { loadRows: async () => ["mock-one", "mock-two", "mock-three"] },
      },
      {
        title: "Mocked error",
        description: "per-example mock throws → error path",
        value: DataList.make(),
        on: autoLoad,
        requestHandlers: {
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
        requestHandlers: { loadRows: () => new Promise(() => {}) },
      },
      {
        title: "No auto-load (click Reload)",
        description: "no `on`; click Reload to hit the real handler",
        value: DataList.make(),
      },
    ],
  };
}
