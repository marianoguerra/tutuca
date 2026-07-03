// Public aggregator for the tutuca inspector components, shipped as
// `tutuca/components` (dist/tutuca-components.js, built with `tutuca` kept
// external — see scripts/dist-ext.js). Mirrors index.js / storybook.js.
//
// These are pure rendering components: a component descriptor, a live instance,
// any value, and `tutuca lint`/`test` results rendered as collapsible trees.
// The storybook engine (src/storybook/) imports getComponents() + the *.Class
// statics from here to power the per-example inspector tabs.

import { getComponents as getDataComponents } from "./data/data.js";
import { getComponents as getImComponents } from "./data/immutable-inspector.js";
import { getComponents as getJsonComponents } from "./data/json.js";
import { getComponents as getSchemaComponents } from "./data/json-schema.js";
import { getComponents as getActivityComponents } from "./tutuca/activity-inspector.js";
import { getComponents as getComponentInspectorComponents } from "./tutuca/component-inspector.js";
import { getComponents as getInstanceInspectorComponents } from "./tutuca/instance-inspector.js";
import { getComponents as getLintComponents } from "./tutuca/lint-inspector.js";
import { getComponents as getTestComponents } from "./tutuca/test-inspector.js";

// Reusable per-instance inspector builder (used by the storybook tabs + playground).
export * from "./build-views.js";
export * from "./data/data.js";
export * from "./data/immutable-inspector.js";
export * from "./data/json.js";
export * from "./data/json-schema.js";
export * from "./tutuca/activity-inspector.js";
export * from "./tutuca/component-inspector.js";
export * from "./tutuca/instance-inspector.js";
export * from "./tutuca/lint-inspector.js";
export * from "./tutuca/test-inspector.js";

// Every inspector component, deduped by name (the shared Immutable/JSON leaf
// sets are listed by several modules — register each only once). Mirrors the
// dedup-by-name union in tutuca/instance-inspector.js.
export function getComponents() {
  const all = [
    ...getActivityComponents(),
    ...getComponentInspectorComponents(),
    ...getInstanceInspectorComponents(),
    ...getLintComponents(),
    ...getTestComponents(),
    ...getDataComponents(),
    ...getSchemaComponents(),
    ...getImComponents(),
    ...getJsonComponents(),
  ];
  const seen = new Set();
  return all.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}
