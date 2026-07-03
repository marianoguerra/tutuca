// Wires the core transaction observer (app.observe / Transactor.observe) to the
// per-example Activity tab. Imports the framework only via bare "tutuca" and the
// inspector renderers via "tutuca/components", matching the rest of the engine.
//
// The whole storybook is a single app/transactor; each example's component lives
// at sections[si].items[ii].value. We record only transactions whose path is
// inside some example's `.value` subtree and route each to that example's log.
// The log-append targets the Example node itself (sections[si].items[ii] — one
// step ABOVE `.value`), so it fails this same filter and is never re-logged.
import { rootDispatcher } from "tutuca";
import { InstanceInspector, isComponentInstance } from "tutuca/components";
import { ActivityEntry } from "./components.js";

// Render any leaf value: a tutuca component instance shows its field → value
// rows (InstanceInspector + its descriptor); anything else falls back to the
// plain data inspector (InstanceInspector handles both).
function inspect(app, value) {
  const comp = isComponentInstance(value) ? app.comps.getCompFor(value) : null;
  return InstanceInspector.Class.fromData(value, comp);
}

// Wall-clock HH:MM:SS.mmm for an event's timestamp (record.timestamp is Date.now()).
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// The path within the example (drop the sections[si].items[ii] prefix), e.g.
// "value" or "value.rows[1]".
function pathLabelFor(pathKeys) {
  return pathKeys
    .slice(2)
    .map((k) => (k.key === undefined ? k.field : `${k.field}[${k.key}]`))
    .join(".");
}

// Turn a raw core observer record into a display row. Extracts only renderable
// data — never stores functions, Paths, or transactions in state.
function recordToEntry(app, record) {
  const hasAfter = record.after !== undefined;
  // Primary label: the dispatched message name, or — for a raw DOM input, which has no
  // message name — the handler. The separate handler column is shown only when it
  // genuinely differs (e.g. a `$unknown` fallback): for a named handler the two are
  // identical (the handler is the method named after the message), so we'd just be
  // printing the same word twice.
  const primary = record.name ?? record.handlerName ?? "?";
  const handler = record.handlerName ?? "";
  const handlerLabel = handler && handler !== primary ? `→ ${handler}` : "";
  return ActivityEntry.make({
    kind: record.kind ?? "",
    name: primary,
    handlerName: handlerLabel,
    matched: record.matched ?? "",
    pathLabel: pathLabelFor(record.pathKeys),
    time: fmtTime(record.timestamp),
    before: inspect(app, record.before),
    after: hasAfter ? inspect(app, record.after) : null,
    hasAfter,
  });
}

// Subscribe the app's transaction observer, routing each record that occurs
// inside an example's `.value` subtree to that example's activity log. Returns
// the unsubscribe function from app.observe.
export function subscribeExampleActivity(app) {
  return app.observe((record) => {
    const keys = record.pathKeys;
    if (
      keys.length < 3 ||
      keys[0].field !== "sections" ||
      keys[1].field !== "items" ||
      keys[2].field !== "value"
    )
      return;
    const si = keys[0].key;
    const ii = keys[1].key;
    if (si === undefined || ii === undefined) return;
    rootDispatcher(app.transactor)
      .at.index("sections", si)
      .index("items", ii)
      .send("logActivity", [recordToEntry(app, record)]);
  });
}
