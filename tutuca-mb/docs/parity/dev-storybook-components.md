# Parity: dev, storybook, components and demos tests

How each JS test in `test/dev`, `test/storybook`, `test/components` and `test/demos` maps to
the MoonBit port. Status is one of:

- **Ported**: an equivalent MoonBit test, or a smoke-script assertion for what needs a real DOM.
- **By types**: the compiler enforces it.
- **Divergent**: the port deliberately differs (see the README's intentional differences).
- **Missing**: not in the port.

Generated JS tests (one per story or component) count once per generator.

The Assertions column records an audit of every ported row: the JS test's assertions read
against the MoonBit test's or smoke script's, row by row. "same" means the same observable
behaviour with equivalent assertions (values, text, order, errors), adjusted only for the
differences the row names; "strengthened" means the port asserted less and now asserts what
JS does.

| Assertion audit | Rows |
|---|---|
| Ported rows audited | 86 |
| audited: same | 67 |
| audited: strengthened | 19 (one with a bug fix) |
| Reclassified as divergent | 0 |
| Divergent rows (not audited) | 2 |

## Summary

| Suite | JS tests | Ported | By types | Divergent | Missing |
|---|---|---|---|---|---|
| test/dev (classes, vdom-formatters) | 10 | 9 | 0 | 1 | 0 |
| test/storybook (stories, storybook, element) | 32 | 31 | 0 | 1 | 0 |
| test/components (todo, json, json-schema, drawing-math, thing-tracker) | 41 | 41 | 0 | 0 | 0 |
| test/demos | 6 | 6 | 0 | 0 | 0 |
| **Total** | **89** | **87** | **0** | **2** | **0** |

Fixed along the way:
- A story runner dropped the reports of its first render (it set `on_report` after `host.start`), so a story starting in an invalid state showed no problems (storybook/runner.mbt).
- `<tutuca-app>`: changing `app-key` never disposed the old key's app, and reports queued under an old key were still delivered (storybook/web/web.mbt).

Added:
- `check_books` checks that every story starts valid and renders, names failing sequences by story id, and takes `stress=`/`steps=`/`seed=` to stress-test every story.
- A runs input for the UI's stress test (`SetRuns`, storybook/ui.mbt).
- `Arbitrary` for drawing's `Box`, `Poly` and `Shape`, so the shape components get generic-property checks.

Added afterwards: the `scroll_to_top` ask on a pick (as JS's `scrollToTop`), and `<tutuca-app>` as @browser's general element (`define_app_element`, `on_app_request`, `mount_app`, `AppRequest::emit`), which the storybook answers as one listener.

JSON Schema generic properties now run on every schema component, each with random states of its own kind (examples/jsonschema/jsport_jsonschema_props_wbtest.mbt); `Studio` isn't one of JS's schemaComponents.

Fixed during the assertion audit: the storybook scanned a preview's classes when its story reported a user event's task, before the host rendered it, so classes an interaction revealed (JSON's edit view) were compiled one change late; the scan now waits for the render (storybook/web/web.mbt).

## test/dev

### classes.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| collectClasses finds constant classes in nested $if branches | Ported | "collectClasses finds constant classes in nested $if branches" (dev/jsport_dev_test.mbt): `Component::class_names` over `if_` branches, `class_` escaping it and found by `ClassCollector::scan`; `ClassCollector(known=...)` keeps the names it is given. | audited: same (the seven constant names, the computed class and title left out; a given set keeps its names) |

### vdom-formatters.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| install is idempotent per target | Ported | scripts/smoke.mjs: one `tutuca` formatter in `devtoolsFormatters` (`install_ffi` returns when one is there; `expose` and `inspect` both install). | audited: strengthened (browser/jsport_formatters_wbtest.mbt, js target: installed twice, one tutuca formatter; the smoke only saw one install) |
| ignores values it doesn't know | Ported | scripts/smoke.mjs: `header` is null and `hasBody` false for `1, "s", null, undefined, {}, [], [1, {}], () => {}`. The formatter only takes values `@browser` built from a `@dev.Described`. | audited: strengthened (the wbtest feeds JS's list with a real described value inside the mixed array, as JS's [1, h(p)], and checks the formatter does take the described value itself) |
| large non vdom arrays bail out on the first item | Ported | scripts/smoke.mjs: a 100000-item Proxy array gets null with at most one item read (it reads none: it checks a marker, not the items). On the MoonBit side `describe_vnodes` takes `Array[VNode]`, so by types too. | audited: strengthened (exactly 0 items read, was at most 1; JS reads 1 because it inspects the first item, the port checks a marker) |
| elements with a short text child render inline | Ported | "elements with a short text child render inline" (dev/describe_test.mbt) | audited: same |
| elements with children expand and close | Ported | "elements with children expand and close" (dev/describe_test.mbt) | audited: strengthened (has_body is true, JS's hasBody assertion, was missing) |
| attribute values | Ported | "attribute values" (dev/describe_test.mbt). `oninput=ƒ` is divergent: handlers aren't vnode attributes in the port (`data-h` plus a handler table). | audited: same, but for the handler attribute (documented divergence in the row) |
| namespaces only show when not implied | Ported | "namespaces only show when not implied" (dev/describe_test.mbt) | audited: same |
| text, comments, fragments and vnode arrays | Ported | "text, comments, fragments and vnode arrays" (dev/describe_test.mbt) | audited: same |
| comment hook | Divergent | No hook option: the one thing JS used it for, showing metadata comments as the component they open, is built in. "metadata comments show the component they open" (dev/describe_test.mbt). | n/a (divergent) |

## test/storybook

The JS tests drive the JSON and math books; the storybook package can't depend on the
examples, so its tests use small components of their own (`Flip` for JSON's Bool editor,
`Tally` for the buggy counter). The UI runs on memdom through `@testing.Driver` with a
`Registry` answering its asks; `<tutuca-app>` itself is js-only and checked in jsdom by
scripts/smoke-storybook.mjs.

### stories.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the {book} components lint clean (errors only, per book) | Ported | `check_books` raises on any story component's `check()` issues: examples/*/stories/stories_test.mbt and examples/devtools/stories_test.mbt. | audited: same, stricter (any check() issue fails, not only errors) |
| {story.id} starts valid and renders (per story) | Ported | `check_books` now mounts every story, sequences or not, and raises on first-render problems or an empty root: "{story.id} starts valid and renders" (storybook/jsport_storybook_test.mbt); all example books via their stories tests. | audited: same (no problems on the first render, a root with children; a failure names the story) |
| {story.id} sequences pass (per story) | Ported | `check_books` in examples/*/stories/stories_test.mbt. | audited: same |
| {story.id} stress test passes (per story) | Ported | `check_books(..., stress=...)` (new): "<book> stress tests pass" in each examples/*/stories/jsport_stories_test.mbt and examples/devtools/jsport_stories_test.mbt, 20 runs of 10 messages, seed 1; every book passes. | audited: same (20 runs, seed 1); 10 messages per run for every story, where JS takes each story's maxCommands |
| checkStory names the step that fails | Ported | "checkStory names the step that fails" (storybook/jsport_storybook_test.mbt): the same message, `Bugs/Counter › wrong check › 2. two: failed check failed: two`. | audited: same (the exact message) |
| stressStory finds the schema break | Ported | "stressStory finds the schema break" (storybook/jsport_storybook_test.mbt), with `check_books(stress=...)`. The break is an invariant (`under three`), as schemas are types here. | audited: strengthened (the exact message: story, the shrunk steps and the broken invariant; was a prefix and a substring) |
| a runner steps through a sequence, back and forth | Ported | same title (storybook/jsport_storybook_test.mbt): `Show`, `Forward`, `Back`, `Goto`, `ToEnd`, the canvas following the timeline. | audited: same (sequences, statuses, cursor and next step, back/goto states, canvas text, to-end statuses, 5 entries) |
| user interaction in the canvas becomes a timeline entry | Ported | same title (storybook/jsport_storybook_test.mbt): an event through the story's host makes a `user` entry labelled with the task (`Flip.Toggle`, JS `click → toggle()`). | audited: same; the entry's label is the typed task (Flip.Toggle) where JS prints click → toggle() |
| single steps: send to a target, generate args, random step | Ported | same title (storybook/jsport_storybook_test.mbt): `SendJson`, `Registry::sample`, `Random`. The UI's form, as JS's, sends a message name and a JSON array of arguments, which it makes the typed message's JSON (`["SetTitle", "x"]`); the registry takes that JSON, so the bad input is one that doesn't decode. Its targets are every component instance the state holds, with JS's labels (`Host::instances`, from the components' `children=`), and a component's messages include the notifications it hears and its ask replies (`json_messages(heard=, replies=)`). | audited: same, adjusted for typed messages (targets and keys, the sent state, a sample, 3 entries ending in a step, the bad input refused) |
| stress finds a counterexample that replays in the stepper | Ported | same title (storybook/jsport_storybook_test.mbt); also "a failed stress run is loadable as its shrunk counterexample" (storybook/storybook_test.mbt). | audited: same |
| stress can be cancelled and reports progress | Ported | "stress runs in batches with progress, and can be cancelled" (storybook/storybook_test.mbt): batches per scheduled tick, `done` growing, `StressCancel`. | audited: same (cancelled status, progress with done above 0 reported as changes) |
| a generated story is sampled with the seed in its key | Ported | same title (storybook/jsport_storybook_test.mbt): a `generated_story` mounted with the same seed twice draws the same state, another seed another; the `@seed` key format in "app-key: a prefix, a story id and an optional @seed" (internal/previews/jsport_web_wbtest.mbt, all targets); "a sampled story starts from its seed's state" (storybook/storybook_test.mbt). | audited: same, plus another seed draws another state |
| removing the element disposes the runner | Ported | same title (storybook/jsport_storybook_test.mbt) for `Registry::unmount`; the element in scripts/smoke-storybook.mjs (removed, then put back, it mounts a new app). | audited: same (runner count 1 then 0; the element's half in the smoke) |
| classes stories compute at render compile into their shadow roots | Ported | scripts/smoke-storybook.mjs (margaui's CSS for the preview's classes lands in its shadow root); computed classes found after a render: "class collection reports constant classes, then computed ones from the DOM" (dev/dev_test.mbt). | audited: strengthened and fixed (scripts/smoke-storybook.mjs mounts JSON/Document: decoration-dashed is not compiled in view mode and is after a click on Edit; it only checked .flex). Bug: storybook/web scanned the preview before the click's render, so such classes compiled one change late |

### storybook.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the storybook components lint clean | Ported | "storybook lints clean" (storybook/jsport_storybook_test.mbt) | audited: same |
| {Storybook, StoryLink, StoryPanel, StressPanel, dev components} have the generic properties | Divergent | `check_component` needs `Arbitrary` states and messages; the UI's state holds summaries from a live runner and its messages carry ask results, so random ones aren't meaningful. The UI is covered by the Driver tests below; the dev panel's components have their own ("dev components have the generic properties", dev/dev_test.mbt). | n/a (divergent) |
| pick a story, step through it and rewind | Ported | same title (storybook/jsport_storybook_test.mbt) | audited: same; the picked id stands for JS's app-key attribute, which the smoke checks on the real element |
| groups collapse, a filter shows their matches, and a pick scrolls to the top | Ported | same title (storybook/jsport_storybook_test.mbt); "the story list filters and folds" (storybook/storybook_test.mbt) | audited: same (a stale comment saying the scroll was not ported fixed) |
| … and a pick scrolls to the top | Ported | "picking a story asks to scroll the panel back to its top" (storybook/storybook_test.mbt); `@web.start` answers `scroll_to_top` by scrolling `[data-story-main]` and the page, as JS. | audited: strengthened (scripts/smoke-storybook.mjs: the story panel scrolled to 500 is at 0 after a pick, the same node, as JS's scrollTop check) |
| clicks in the story canvas show up in the timeline | Ported | same title (storybook/jsport_storybook_test.mbt); in jsdom through the real element in scripts/smoke-storybook.mjs. | audited: same |
| send a message from the step form | Ported | same title (storybook/jsport_storybook_test.mbt): the Message select and the arguments input, Send, the label in the timeline (`Tally at ·.up()`, as JS's); Generate args fills the arguments. | audited: same, adjusted for typed messages (the preview's text and the entry's label) |
| the dev tab inspects the story's state, tasks, components and lint | Ported | same title (storybook/jsport_storybook_test.mbt): state, tasks, specs and issues after a step; folded rows and specs kept across steps. | audited: strengthened (expands the folded state node and checks its field shows, as JS's Expand and showText; was only folding) |
| a stress run from the UI reports its result | Ported | same title (storybook/jsport_storybook_test.mbt), with the runs input added for it. | audited: same (passed, 15 done) |

### element.test.js

As in JS, `<tutuca-app>` is general (`browser/app_element.mbt`, a port of element.js): it
dispatches `tutucarequest`, which any listener answers (`on_app_request` + `mount_app`, as
`mountTutucaApp`), and the app reports with `AppRequest::emit(type, data)`. The storybook
answers the requests under its root and emits each story's summary as `state`;
examples/counter/web mounts plain counters that emit `count` (scripts/smoke-demos.mjs, "app
element ok").

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the inner app mounts in the shadow root and survives outer renders | Ported | scripts/smoke-storybook.mjs: no light-DOM children, and after the UI re-renders the same element and the same shadow nodes. | audited: strengthened (counts tutucarequest events: one mounts the preview, none on the outer render, as JS's mounted.length) |
| inner clicks reach the inner host, and the outer host only sees the element | Ported / Divergent | scripts/smoke-storybook.mjs: the click reaches the story (a timeline entry) and the page sees it targeted at the element. Divergent: handlers of the outer host around the element don't run for events from inside it, since events stop at another host's root (README, event routing). | audited: same for the ported half (the story gets the click, the page sees the element as target); the outer click handler is the documented divergence |
| changing app-key disposes the app and requests a new one | Ported | scripts/smoke-storybook.mjs: a new key mounts a new app. **Fixed**: the old key's app was never disposed (the disconnect read the new key and the element was still connected). | audited: strengthened (wraps the controller's dispose as JS does: the old key's app disposed, one new request for the new key) |
| removing the element disposes its app | Ported | scripts/smoke-storybook.mjs; "removing the element disposes the runner" (storybook/jsport_storybook_test.mbt). | audited: strengthened (the dispose recorded and controller null, as JS) |
| moving the element keeps its app | Ported | scripts/smoke-storybook.mjs: moved to another parent, the same app (same shadow root node). | audited: strengthened (no dispose and no new request, as JS's mounted and disposed) |
| emit reaches an outer @on.tutucareport handler; stale requests are dropped | Ported | scripts/smoke-storybook.mjs: reports bubble from the element as `tutucareport`, after the event (queued), and those queued under a key the element no longer has are dropped. **Fixed**: stale reports were delivered. App-side `emit`: examples/counter/web emits `count` after each click (scripts/smoke-demos.mjs). | audited: same (queued, then delivered with key, type and data; stale key dropped); the smoke now also checks the data |
| an element nobody answers says so | Ported | scripts/smoke-storybook.mjs: `no app for No/Such story`. | audited: strengthened (controller null, JS's second assertion) |
| the outer view lints clean | Ported | "the outer view lints clean" (storybook/jsport_storybook_test.mbt): the storybook UI, the component holding the `<tutuca-app>`. | audited: same (the storybook UI is the view holding the element) |

## test/components and test/demos

### todo.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| due labels are relative to today | Ported | same title (examples/todo/todo_wbtest.mbt) | audited: strengthened (all five tones in order; two were checked) |
| isIso only accepts real dates | Ported | "is_iso only accepts real dates" (examples/todo/todo_wbtest.mbt) | audited: same |
| quick add parses dates, priority, project and labels | Ported | same title (examples/todo/todo_wbtest.mbt) | audited: same |
| quick add never loses words | Ported | same title (examples/todo/todo_wbtest.mbt) | audited: same |
| todo components have the generic properties (TodoApp with todoAppArb) | Ported | "the small components have the generic properties", "tasks have the generic properties on states that keep their invariants" (todo_wbtest.mbt); "TodoApp has the generic properties on generated apps" (examples/todo/jsport_todo_wbtest.mbt) | audited: same (all four components, the app from generated apps) |
| dev components have the generic properties | Ported | "dev components have the generic properties" (dev/dev_test.mbt): `check_component` over DevNode, DevSection, DevLint and DevPanel, as JS's testGenericProperties(devComponents); driven too in "dev nodes open into their rows and close keeping them" and "the dev panel shows the state, tasks, components and lint, readable or as code" | audited: same (the four components, generated states and messages) |

### json.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the JSON components lint clean | Ported | "JSON lints clean" (examples/json_editor/jsport_json_wbtest.mbt) | audited: same |
| JSON components have the generic properties | Ported | "JSON components have the generic properties" (jsport_json_wbtest.mbt) | audited: strengthened (JsonNull and JsonSelector added: every JSON component, as JS) |
| fromJson and toJson round trip | Ported | same title (jsport_json_wbtest.mbt) | audited: same (100 random values) |
| the main view reads as JSON | Ported | same title (jsport_json_wbtest.mbt) | audited: same |
| the edit view shows the same text, with inputs in place of values | Ported | same title (jsport_json_wbtest.mbt) | audited: same |

### drawing-math.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| drawing components have the generic properties | Ported | "drawing components have the generic properties" (examples/drawing/jsport_drawing_wbtest.mbt), with new `Arbitrary` impls for shapes | audited: same |
| math components have the generic properties | Ported | "math components have the generic properties" (examples/math/jsport_math_components_wbtest.mbt); "the math components have the generic properties" (math_wbtest.mbt) | audited: same |
| shapes render as SVG elements inside the canvas | Ported | same title (examples/drawing/drawing_wbtest.mbt) | audited: same |
| formulas render as MathML | Ported | "formulas render as MathML, the plot as SVG" and "numbers read as MathML shows them" (examples/math/math_wbtest.mbt) | audited: same |
| a drag ends on release over the shape, so later moves don't move it | Ported | same title (drawing_wbtest.mbt) | audited: same |
| duplicating and moving shapes at the edge keeps them in range | Ported | same title (drawing_wbtest.mbt) | audited: strengthened (the press is the ShapeDown message, as JS's shapeDown, checked to pick the copy up; it restarted the driver with the drag set) |

### json-schema.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the JSON Schema components lint clean | Ported | "JSON Schema lints clean" (examples/jsonschema/jsport_jsonschema_wbtest.mbt) | audited: same |
| schema components have the generic properties | Ported | "the schema components have the generic properties" (jsonschema_wbtest.mbt); from `SchemaRoot` only, so inner components get random states only inside generated trees | audited: strengthened (every schema component: Arbitrary for each node state, examples/jsonschema/jsport_jsonschema_props_wbtest.mbt; was SchemaRoot only) |
| readKind follows the order a validator reads a schema in | Ported | "read_kind follows the order a validator reads a schema in" (jsonschema_wbtest.mbt) | audited: same |
| a schema reads back as itself when it only uses what the family models | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| reading a tree back is a fixed point | Ported | same title (jsonschema_wbtest.mbt) | audited: strengthened (the grammar now has multipleOf, as JS's) |
| generated trees read back to a fixed point | Ported | same title (jsport_jsonschema_wbtest.mbt) | audited: same |
| the semantic view reads as a data dictionary | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| the format view reads as keywords | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a closed node hides what is below it | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a click toggles one node | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a ctrl click toggles a node and its siblings | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a ctrl+alt click toggles a node and everything below it | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| expand all and collapse all reach every node | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a property passes setOpen to its schema | Ported | "a property passes SetOpen to its schema" (jsonschema_wbtest.mbt) | audited: same |
| a long list shows one page at a time | Ported | same title (jsonschema_wbtest.mbt) | audited: same |
| a short list has no pager | Ported | same title (jsonschema_wbtest.mbt) | audited: same |

### thing-tracker.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| relative times and bucket labels | Ported | same title (examples/thingtracker/model_wbtest.mbt) | audited: same |
| time zones shift days, and datetime-local round trips | Ported | same title (model_wbtest.mbt) | audited: same |
| measurements convert and format | Ported | same title (model_wbtest.mbt) | audited: same |
| search ranks titles over descriptions and needs every term | Ported | same title (model_wbtest.mbt) | audited: same |
| rows: tags in order, then the ungrouped | Ported | same title (model_wbtest.mbt) | audited: same |
| buckets count per thing and leave gaps between days | Ported | same title (model_wbtest.mbt) | audited: same |
| imports: errors, merges and replaces | Ported | same title (model_wbtest.mbt) | audited: same |
| tracker components have the generic properties (TrackerApp with trackerAppArb) | Ported | "the small components have the generic properties", "the panels have the generic properties", "the app has the generic properties on generated apps", "the tracker components check clean" (examples/thingtracker/app_wbtest.mbt) | audited: same (all twelve components, the app from generated apps) |

### demos.test.js

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| drawing demo: picks a tool | Ported | same title (examples/drawing/stories/jsport_drawing_demo_test.mbt); scripts/smoke-demos.mjs | audited: same |
| math demo: saves, reopens and removes problems | Ported | same title (examples/math/jsport_math_wbtest.mbt); scripts/smoke-demos.mjs | audited: same |
| todo demo: quick adds a task in plain words | Ported | same title (examples/todo/jsport_todo_wbtest.mbt); DOM quick add in scripts/smoke.mjs | audited: same |
| json studio demo: the schema follows the payload | Ported | same title (jsport_jsonschema_wbtest.mbt); scripts/smoke-demos.mjs | audited: same |
| inferSchema: types, formats, required keys and merged items | Ported | same title (jsport_jsonschema_wbtest.mbt) | audited: same |
| thing tracker demo: logs a thing with a tap | Ported | same title (examples/thingtracker/app_wbtest.mbt); scripts/smoke-demos.mjs | audited: strengthened (the exact thing id, and checkClean's renders and lint checks) |

The JS demos' `checkClean` step (no lint errors, renders, no problems) is covered by each component's `check()` test and by the assertions in each demo port.

