// 06 — LIFECYCLE HOOKS: the `on` field on an example.
//
// `on` declares messages the storybook dispatches to the example's component
// (`.value`) as you navigate:
//   - init    — first time the section is displayed
//   - resume  — each later time the section is displayed
//   - suspend — when you navigate away from the section
//
// Each phase holds action buckets, run in this order: send → bubble → request →
// input, then an explicit `do` array (ordered, mixed kinds, each item has `type`).
//   - send    → a receive handler on the value
//   - request → resolves (honoring per-example mocks) and feeds a response handler
//   - input   → an input handler on the value
//   - bubble  → propagates UPWARD from the value (see note below)
// `args` is an array, or a function `(self) => [...]` evaluated at dispatch with
// `self` = the value instance.
//
// NOTE on `bubble`: a bubble travels up to ANCESTOR components. An example's value
// sits under the storybook engine's own components, so a lifecycle `bubble` reaches
// the engine (a no-op for author handlers). It is included in the API for symmetry
// and for composed apps; the visibly-useful kinds here are send / request / input.
//
// HOW TO SEE IT: open this section, watch each card log `init`. Then click another
// section in the sidebar and come back — the last card logs `suspend` then `resume`.
import { component, html } from "tutuca";

// Renders a running log of every lifecycle/action message it receives, so the
// effect of `on` is visible on the card itself.
const LifecycleProbe = component({
  name: "LifecycleProbe",
  fields: { title: "probe", log: [] },
  methods: {
    note(msg) {
      return this.setLog(this.log.push(msg));
    },
    count() {
      return this.log.size;
    },
  },
  receive: {
    onInit(label) {
      return this.note(label != null ? `init · ${label}` : "init");
    },
    onResume() {
      return this.note("resume");
    },
    onSuspend() {
      return this.note("suspend");
    },
    ping(arg) {
      return this.note(`send → ping(${arg})`);
    },
  },
  input: {
    setSeed(value) {
      return this.note(`input → setSeed(${value})`);
    },
  },
  response: {
    fetchThing(res, err) {
      return this.note(err ? `request → error: ${err.message}` : `request → ok: ${res}`);
    },
  },
  view: html`<div class="card bg-base-100 shadow-sm">
    <div class="card-body gap-2">
      <h3 class="card-title text-base" @text=".title"></h3>
      <p class="text-xs opacity-60">
        messages received (newest last) — count: <span @text="$count"></span>
      </p>
      <ol class="text-sm font-mono bg-base-200 rounded p-2 max-h-40 overflow-y-auto">
        <li @each=".log"><x text="@value"></x></li>
      </ol>
    </div>
  </div>`,
});

export function getComponents() {
  return [LifecycleProbe];
}

export function getRoot() {
  return LifecycleProbe.make({ title: "probe" });
}

// A real handler so the `request` action has something to resolve.
export function getRequestHandlers() {
  return { fetchThing: async () => "live data" };
}

const probe = (title) => LifecycleProbe.make({ title });

export function getExamples() {
  return {
    title: "06 · Lifecycle (on)",
    description:
      "on.init/resume/suspend dispatching send/request/input/do to the example's component",
    items: [
      {
        title: "init → send",
        description: "sends a `ping` receive message on first show",
        value: probe("init → send"),
        on: { init: { send: [{ name: "ping", args: ["hello"] }] } },
      },
      {
        title: "init → input",
        description: "invokes the `setSeed` input handler",
        value: probe("init → input"),
        on: { init: { input: [{ name: "setSeed", args: [42] }] } },
      },
      {
        title: "init → request",
        description: "issues `fetchThing`; its response logs (real handler)",
        value: probe("init → request"),
        on: { init: { request: [{ name: "fetchThing", args: [] }] } },
      },
      {
        title: "init → request (mocked)",
        description: "per-example mock overrides the real fetchThing",
        value: probe("init → request (mocked)"),
        on: { init: { request: [{ name: "fetchThing", args: [] }] } },
        requestHandlers: { fetchThing: async () => "MOCKED data" },
      },
      {
        title: "init → do (ordered, mixed)",
        description: "explicit ordered sequence across kinds",
        value: probe("init → do"),
        on: {
          init: {
            do: [
              { type: "send", name: "ping", args: ["first"] },
              { type: "input", name: "setSeed", args: [2] },
              { type: "request", name: "fetchThing", args: [] },
            ],
          },
        },
      },
      {
        title: "args as a function",
        description: "args:(self)=>[...] computed from the instance at dispatch",
        value: probe("args fn"),
        on: { init: { send: [{ name: "ping", args: (self) => [`title="${self.title}"`] }] } },
      },
      {
        title: "init + resume + suspend",
        description: "all three phases — navigate away and back to see suspend then resume",
        value: probe("init + resume + suspend"),
        on: {
          init: { send: [{ name: "onInit", args: ["first show"] }] },
          resume: { send: [{ name: "onResume", args: [] }] },
          suspend: { send: [{ name: "onSuspend", args: [] }] },
        },
      },
    ],
  };
}
