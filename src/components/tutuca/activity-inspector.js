// Reusable display + transform for the transaction-observer "Activity" feature
// (see Transactor.observe / app.observe). Host-agnostic: the storybook and the
// playground both render these components and build their rows with the same
// `recordToEntry` transform, instead of each reimplementing it. A host wires its
// own `app.observe(...)` subscription and decides how to route/store the rows
// (e.g. per-example in the storybook, a single flat log in the playground).
import { component, html } from "tutuca";
import { InstanceInspector, isComponentInstance } from "./instance-inspector.js";

// Newest-first cap for an activity log (see ActivityLog.appendEntry).
const ACTIVITY_CAP = 50;

// One row of dispatch activity. Pure display: a host builds these from normalized
// observer records via `recordToEntry`, prebuilding the `before`/`after` value
// inspectors so no functions, Paths, or transactions are ever stored in state.
// `after` is null (and hidden) for the outgoing side of a request.
export const ActivityEntry = component({
  name: "ActivityEntry",
  fields: {
    kind: "",
    name: "",
    handlerName: "",
    matched: "",
    pathLabel: "",
    time: "",
    before: null,
    after: null,
    hasAfter: true,
  },
  view: html`<div
    class="rounded border border-base-content/15 p-2 text-sm flex flex-col gap-1"
  >
    <div class="flex items-center gap-2 flex-wrap">
      <span
        title="How this was dispatched: receive (send), bubble, response, input, or request"
        class="badge badge-sm badge-neutral"
        @text=".kind"
      ></span>
      <span
        title="Message name dispatched — for a DOM input, the event type (click, input, change, keydown, …)"
        class="font-mono font-semibold"
        @text=".name"
      ></span>
      <span
        title="Actual handler that ran — shown only when it differs from the name (e.g. a $unknown fallback)"
        class="text-xs opacity-60 font-mono"
        @show="truthy? .handlerName"
        @text=".handlerName"
      ></span>
      <span
        title="Path to the target component"
        class="text-xs opacity-40 font-mono"
        @text=".pathLabel"
      ></span>
      <span
        title="Handler resolution — exact: matched by name · unknown: $unknown fallback · none: no handler (no-op)"
        class="badge badge-xs badge-ghost"
        @show="truthy? .matched"
        @text=".matched"
      ></span>
      <span
        title="Time this event ran (HH:MM:SS.mmm)"
        class="ml-auto text-xs opacity-40 font-mono tabular-nums"
        @text=".time"
      ></span>
    </div>
    <div class="flex gap-3 items-start font-mono text-xs">
      <div class="flex-1 min-w-0">
        <div class="opacity-50" title="Target state before the handler ran">before</div>
        <x render=".before"></x>
      </div>
      <div class="flex-1 min-w-0" @show=".hasAfter">
        <div class="opacity-50" title="Target state after the handler ran">after</div>
        <x render=".after"></x>
      </div>
    </div>
  </div>`,
});

// A bounded, newest-first, scrollable list of ActivityEntry rows. `appendEntry`
// returns a new log with the entry prepended and the list capped — call it from a
// host's observer subscription. Renders an empty hint until the first entry lands.
export const ActivityLog = component({
  name: "ActivityLog",
  fields: { events: [], hasEvents: false },
  methods: {
    appendEntry(entry) {
      return this.setEvents(this.events.unshift(entry).slice(0, ACTIVITY_CAP)).setHasEvents(true);
    },
  },
  view: html`<div class="p-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
    <div class="text-xs opacity-40" @hide=".hasEvents">
      No activity yet — interact with the component.
    </div>
    <x render-each=".events"></x>
  </div>`,
});

// Wall-clock HH:MM:SS.mmm for an event's timestamp (record.timestamp is Date.now()).
export function fmtActivityTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// Join a record's pathKeys into a readable label, e.g. "value.rows[1]". A host may
// slice the prefix first (the storybook drops its sections[si].items[ii] prefix).
export function pathKeysLabel(pathKeys) {
  return pathKeys.map((k) => (k.key === undefined ? k.field : `${k.field}[${k.key}]`)).join(".");
}

// A value → view function bound to an app's component registry: a component
// instance renders its field → value rows (InstanceInspector + descriptor); any
// other value falls back to the plain data inspector.
export function makeInspect(app) {
  return (value) => {
    const comp = isComponentInstance(value) ? app.comps.getCompFor(value) : null;
    return InstanceInspector.Class.fromData(value, comp);
  };
}

// Turn a normalized observer record into an ActivityEntry. `inspect` builds the
// before/after value views (see makeInspect); `pathLabel` maps record.pathKeys to
// a label (defaults to the full path). The handler column is shown only when it
// differs from the name — for a named handler the two are identical, so we'd just
// print the same word twice.
export function recordToEntry(record, { inspect, pathLabel = pathKeysLabel } = {}) {
  const hasAfter = record.after !== undefined;
  const primary = record.name ?? record.handlerName ?? "?";
  const handler = record.handlerName ?? "";
  const handlerLabel = handler && handler !== primary ? `→ ${handler}` : "";
  return ActivityEntry.make({
    kind: record.kind ?? "",
    name: primary,
    handlerName: handlerLabel,
    matched: record.matched ?? "",
    pathLabel: pathLabel(record.pathKeys),
    time: fmtActivityTime(record.timestamp),
    before: inspect(record.before),
    after: hasAfter ? inspect(record.after) : null,
    hasAfter,
  });
}

export function getComponents() {
  return [ActivityLog, ActivityEntry];
}
