// Wires the core transaction observer (app.observe / Transactor.observe) to the
// per-example Activity tab. The display + record→entry transform are shared with
// the playground via tutuca/components (recordToEntry / makeInspect); only the
// storybook-specific ROUTING lives here.
//
// The whole storybook is a single app/transactor; each example's component lives
// at sections[si].items[ii].value. We record only transactions whose path is
// inside some example's `.value` subtree and route each to that example's log.
// The log-append targets the Example node itself (sections[si].items[ii] — one
// step ABOVE `.value`), so it fails this same filter and is never re-logged.
import { rootDispatcher } from "tutuca";
import { makeInspect, pathKeysLabel, recordToEntry } from "tutuca/components";

// The label shown per row: the path within the example, i.e. drop the
// sections[si].items[ii] prefix ("value", "value.rows[1]", …).
function storybookPathLabel(pathKeys) {
  return pathKeysLabel(pathKeys.slice(2));
}

// Subscribe the app's transaction observer, routing each record that occurs
// inside an example's `.value` subtree to that example's activity log. Returns
// the unsubscribe function from app.observe.
export function subscribeExampleActivity(app) {
  const inspect = makeInspect(app);
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
    const entry = recordToEntry(record, { inspect, pathLabel: storybookPathLabel });
    rootDispatcher(app.transactor)
      .at.index("sections", si)
      .index("items", ii)
      .send("logActivity", [entry]);
  });
}
