// 06 — LIFECYCLE HOOKS: the `on` field on an example.
//
// `on` declares messages the storybook dispatches to the example's component
// (`.value`) as you navigate:
//   - init    — first time the section is displayed
//   - resume  — each later time the section is displayed
//   - suspend — when you navigate away from the section
//
// Each phase holds action buckets, run in this order: send → intent, then an
// explicit `do` array (ordered, mixed kinds, each item has `type`).
//   - send   → a receive handler on the value; addressed, and it stops there
//   - intent → a walk along `opts.route`, answered into a `receive` arm named
//              <name>Ok / <name>Error / <name>Unhandled
// `args` is an array, or a function `(self) => [...]` evaluated at dispatch with
// `self` = the value instance.
//
// NOTE on the `dyn` leg: it walks up to ANCESTOR components, and an example's value
// sits under the storybook engine's own components — so a lifecycle intent on `dyn`
// walks into the engine rather than into your tree. The visibly-useful shapes here
// are `send` and an intent on the `lex` leg.
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
    count() {
      return this.log.length;
    },
  },
  receive: {
    // Two outcomes, two arms. An answer arrives as an ordinary message, so these sit
    // beside the ones a parent or the host sends and nothing tells them apart.
    fetchThingOk(draft, res) {
      draft.log.push(`intent → ok: ${res}`);
    },
    fetchThingError(draft, err) {
      draft.log.push(`intent → error: ${err.message}`);
    },
    onInit(draft, label) {
      draft.log.push(label != null ? `init · ${label}` : "init");
    },
    onResume(draft) {
      draft.log.push("resume");
    },
    onSuspend(draft) {
      draft.log.push("suspend");
    },
    ping(draft, arg) {
      draft.log.push(`send → ping(${arg})`);
    },
    setSeed(draft, value) {
      draft.log.push(`input → setSeed(${value})`);
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
export function getIntentHandlers() {
  return { fetchThing: async () => "live data" };
}

const probe = (title) => LifecycleProbe.make({ title });

export function getExamples() {
  return {
    group: "Authoring · Behavior",
    title: "Lifecycle (on)",
    description:
      "on.init/resume/suspend dispatching send/intent/do to the example's component",
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
        on: { init: { send: [{ name: "setSeed", args: [42] }] } },
      },
      {
        title: "init → request",
        description: "issues `fetchThing`; its response logs (real handler)",
        value: probe("init → request"),
        on: { init: { intent: [{ name: "fetchThing", args: [], opts: { route: ["lex"] } }] } },
      },
      {
        title: "init → request (mocked)",
        description: "per-example mock overrides the real fetchThing",
        value: probe("init → request (mocked)"),
        on: { init: { intent: [{ name: "fetchThing", args: [], opts: { route: ["lex"] } }] } },
        intentHandlers: { fetchThing: async () => "MOCKED data" },
      },
      {
        title: "init → do (ordered, mixed)",
        description: "explicit ordered sequence across kinds",
        value: probe("init → do"),
        on: {
          init: {
            do: [
              { type: "send", name: "ping", args: ["first"] },
              { type: "send", name: "setSeed", args: [2] },
              { type: "intent", name: "fetchThing", args: [], opts: { route: ["lex"] } },
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
