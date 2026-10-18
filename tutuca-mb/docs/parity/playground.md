# Parity: test/playground and test/site

This covers every `test()` and helper-generated test in `test/playground/*.test.js` and `test/site/examples.test.js`: 19 call sites (a parameterized site counts once). **8 are ported**, **1 holds by types** and **10 are divergent**. None are missing.

The playground is shaped differently in MoonBit, and that explains most of the divergent rows:
- **A run is compiled, not linked.** JS links the edited ES modules as blob URLs and imports them, so it needs an import graph (`sources.js`). Here the edited files are MoonBit packages: one for a site example, several for a library. `@moonbit/moonc-worker` compiles them in a worker against the prebuilt tutuca-mb packages (`scripts/playground-payload.mjs`) and links them into one module, which the page runs. There are no relative imports to follow, rewrite or cycle-check: the example lists its packages and their files, and MoonBit packages can't import in cycles.
- **Two backends.** A run compiles to js (a JS module the page imports) or to wasm-gc (wasm bytes the page instantiates with `wasm/loader.mjs`'s `tdom` imports). The page has a backend select (`?backend=wasm-gc` in its URL), and `<tutuca-playground backend="wasm-gc">` picks it per embed. JS has one backend, so this has no JS counterpart.
- **The right pane is the storybook UI.** JS writes a `Playground` component with a story select and Preview/Steps/Stress/Dev tabs. Here a run's `main` calls `@run.start(books())`, which starts the storybook UI (`storybook/web`) on the pane. That UI already has the story list, and JS's Steps, Stress test and Dev tabs (steps, timeline, the step form, stress tests and the dev panel). The page shell (example select, file tabs, Run/Reset, status, the error panel) is plain JS in `examples/playground/playground.js`, as JS's `element.js` is.
- **Books are found by name.** A run must define `books()`. The boot file `_boot.mbt` calls it, so a missing or mistyped `books` is a compile error listed in the error panel. A library names its own book functions instead (`boot` in `examples.js`). JS uses `booksOf(module)` on whatever the module exports.
- **A library is compiled package by package, as moon builds it.** JS edits a library's `stories.js` and every file it imports relatively, so editing the JSON editor's files changes what JSON Schema uses. Here a library is its stories' package, its components' package and the example packages those build on (examples/common, examples/json_editor, examples/todo). `examples.js` lists them in dependency order, with:
  - their files;
  - the aliases their moon.pkg gives the packages before them (`uses`: `@jv`, `@todo`, `@common`, `@js`, …);
  - the core-library packages they alias otherwise than by their last segment (`std`: `@fm` for moonbitlang/core/math).

  `compile.js` (`compileRun`) builds each package with moonc-worker's `buildPackage`. Each keeps its real name (`marianoguerra/tutuca/examples/json_editor`) and its own aliases. It is compiled against the framework's .mi and the .mi of the packages before it: the ones it imports are given under its aliases, the rest as indirect imports. The last package is the main one, and the boot file joins it. `linkCore` then links the payload's cores and the packages' cores in order. The code runs exactly as written, with no rewriting. Every one of these packages is editable. Only the framework is prebuilt: tutuca, vdom, memdom, testing, dev, storybook, and per backend browser, storybook/web and `run` (js) or wasm and `run_wasm` (wasm-gc). The payload doesn't hold `@common`, `@jv` or `@todo`.
- **Diagnostics name a file by its package.** A library's files are keyed by their path under `examples/` (`json_editor/json.mbt`, `jsonschema/stories/stories.mbt`), and the tabs show those keys. moonc reports `./json.mbt:…` for the package it is building, so `compileRun` rewrites each diagnostic to its file's key (`./json_editor/json.mbt:799:15-799:19 [E4021] …`), and the editor underlines it in that file. A site example's one file keeps its own name (`counter.mbt`). A moonc instance keeps every diagnostic it has reported, once per text, sorted by file and position, so a call's own diagnostics are the ones it hadn't seen (`seen`). Counting them, as before, picked the wrong ones once several packages had reported. Package-level `warnings = "-79"` has no buildPackage option, so `compileRun` drops E0079 itself.

The ports are spread over a few places:
- Moon tests in `examples/playground/playground_test.mbt` (the pure logic) and in `examples/site/*/*_test.mbt` (the examples).
- `scripts/smoke-playground.mjs`. It runs moonc-web.cjs in node exactly as the worker does (`examples/playground/compile.js`), and the page in jsdom with an in-memory editor. It also covers the embeddable `<tutuca-playground>` (`embed.js`), with two on one page.

A fresh browser check (Chrome, through `just serve`) confirmed these paths work:
- the module worker
- CodeMirror's inline underlines and gutter markers
- Ctrl+Enter
- the hash routing
- live clicks in a run's preview

## sources.test.js → (none: no module graph)

| JS test | Status | MoonBit test (file) or reason |
|---|---|---|
| importSpecifiers finds static, re-export, side-effect and dynamic imports, not comments | divergent | A run's imports are packages by alias (`@tutuca`, `@storybook`, `@vdom`, `@testing`, …, and a library's own `@jv`, `@todo`, …), and the compiler resolves them, so there are no specifiers to find. |
| mapSpecifiers keeps quotes and everything around the specifier | divergent | Nothing is rewritten: the files are compiled as written. |
| relativeName names files from the entry's folder | divergent | A site example's file is named by its basename, which is also the name moonc reports diagnostics against (`./typos.mbt:10:39-10:45`). A library's files are named by their path under `examples/` (`json_editor/json.mbt`), and `compileRun` rewrites each package's diagnostics to those names. `groupDiagnostics` maps them back (smoke: `groupDiagnostics keeps each file's and the rest`, `packages compile on their own: the same names and file names in two, errors by package`). |
| loadSources follows relative imports, entry first, and stops at external files | divergent | An example lists its packages and files (`examples/playground/examples.js`), dependencies too, and `mountPlayground().load` fetches them. The tabs show the stories first, then the components, then what they use, as JS shows the entry and then its imports. Smoke checks each package's `uses` (and `std` aliases) against its moon.pkg and that each comes before its user (`each library lists its packages' files…`). `json-schema: the JSON editor is editable…` edits `json_editor/json.mbt`'s "JSON text" label and finds the edit in a JSON Schema studio story after the next run. |
| loadSources reports files it can't load | divergent | Same path. A failed fetch shows `can't load <url>: <status>` in the error panel, through the same `fail` as a failed run (smoke: `a compile error is underlined…` and `mistakes…` cover the panel). |
| linkSources links dependencies first, external files by URL, bare specifiers as they are | divergent | Linking is moonc's `linkCore`: the payload's cores in the order `moon build --dry-run` gives for `examples/playground/link` (`link_wasm` on wasm-gc), then the run's packages' cores in dependency order. Every run compiles and links that way (smoke, all compile tests). |
| linkSources refuses import cycles, naming them | by types | A library's packages are compiled in the order `examples.js` lists them, each against the ones before it, and MoonBit packages can't import in cycles (the compiler refuses them). |
| linked modules run: data URLs stand in for blobs | ported | The page imports a js run as a blob module (`importBlob`). The smoke script passes an `importRun` that writes the linked JS to `_build/playground-smoke/run-N.mjs` and imports it. Every smoke test that reaches `ready` runs one. A wasm-gc run is instantiated by `startWasm` (`playground.js`) with the loader's `tdom` and a `playground` namespace that answers the run's config (`run_wasm`); its `_start` runs `main`. Smoke runs those in jsdom (`wasm-gc: …`). |
| booksOf finds the books a module exports, default first | divergent | Books are named, not discovered: `books()`, which `_boot.mbt` hands to `@run.start`. Smoke: `an error outside the user's files (no books) is listed` renames it and expects the boot file's `E4021` in the error panel. |

## ui.test.js → `scripts/smoke-playground.mjs`, `examples/playground/playground_test.mbt`

| JS test | Status | MoonBit test (file) or reason |
|---|---|---|
| testLintsClean("playground", playgroundComponents) | divergent | The playground adds no components: its right pane is the storybook UI, whose components are checked by the storybook's own tests. The examples' components are checked by `check_books` in each `examples/site/*/*_test.mbt` (it fails on any `check()` issue). |
| testGenericProperties(playgroundComponents) | divergent | Same reason. The storybook UI's components keep their own property tests. |
| storyChoices names stories with their book only when there are many | divergent | The storybook UI's sidebar groups stories by book title, so nothing is relabelled. What a run opens with is ported as `choose_story` (`a run keeps the story asked for when the books still have it`, `a run without a wanted story opens the first one, or none`). |
| a run shows its first story live, and the next run remounts it with the same story | ported | Smoke: `a run shows its first story live, keyed by the run` (`p1r1/Counter/From zero`, the preview shows `−0+`, and a click in it counts) and `the next run remounts with the story the last one showed` (after picking "From ten" and editing, run N+1 is `p1rN+1/Counter/From ten` and shows the edit). On wasm-gc: `wasm-gc: the counter compiles to wasm, runs live, and keeps its story across runs`. |
| a run can ask for a story, and tabs show the steps and dev panels | ported | Smoke: `a run can ask for a story` (`load("async", { story: "Weather/Atlantis" })` mounts `p1rN/Weather/Atlantis`, and its ask answers live). Steps run through the storybook UI in every `<example>: its stories … pass their sequences in the UI` test (each sequence picked, Run to end `⏭`, every step `ok`). The Steps and Dev tabs are the storybook's, as JS's. |
| a failed run shows its error; picks are asked of the element | ported | Smoke: `a compile error is underlined in its file and listed; the next good run clears it` and `mistakes: the compiler's errors, then check()'s issues fail the run, then it runs` (and `wasm-gc: a compile error is listed, and check()'s issues fail the run`). That one picks the example through the select, and `onChange` reports the pick like JS's `playgroundchange`. A run that throws (here: components with `check()` issues, which can't render) shows `The run failed: …`. |
| StoryRegistry with a prefix mounts only its own keys | ported | Smoke: `a run's previews answer only their own keys` (a `p1r1/…` element added under a later run says "no app for" its key). This needed `Storybook::of(prefix~)`: the UI now binds `app-key` to prefix + story, where before only `web.start` knew the prefix. |

## site/examples.test.js → `examples/site/*/*_test.mbt`, `scripts/smoke-playground.mjs`

| JS test | Status | MoonBit test (file) or reason |
|---|---|---|
| testLintsClean(name, book.components) for counter, todo-list, composed, async | ported | `check_books` in `counter_test.mbt`, `todo_list_test.mbt`, `composed_test.mbt` and `async_test.mbt` raises on any `Component::check()` issue. Most JS lint rules are compile errors here, and `moon check` runs on all three targets. |
| `${story.id} starts valid and its sequences pass` (every story of the four) | ported | `check_books` (memdom, every target) runs every sequence and fails on an initial problem or a step that isn't ok. Smoke runs them again in the browser path: compiled by moonc-web.cjs, live in the storybook UI, each sequence to the end. |
| the mistakes example has exactly the three mistakes it describes | ported | Two halves, because MoonBit catches the JS lint codes at compile time. (1) Smoke: `the compiler reports the three mistakes of typos.mbt`. `unknown-field` is E4091 `no field nmae`, `send-arity` is E4014/E4203 for `on_click(Rename)`, and `unknown-handler` is E4031 `no constructor Reset`. `typos.mbt` lives in `examples/site/mistakes/broken/`, outside the package, so `moon test` doesn't compile it. (2) `mistakes_test.mbt` asserts `greeting.check()` reports exactly its three issues (unknown event `clik`, `class` set twice, two `click` handlers), and that `check_books` fails with them. Smoke then fixes both files in the page and runs "greet twice". |

## The examples

`site/examples/*.js` → `examples/site/<name>/<name>.mbt`, each its own package (aliases `@tutuca`, `@vdom`, `@testing`, `@storybook`, `@quickcheck`, as the playground compiles them), defining `books()`:

| JS | MoonBit | Differences |
|---|---|---|
| counter.js | `counter/counter.mbt` | The buttons are found by `aria-label`. "From zero" has stress targets (`root_messages`). |
| todo-list.js | `todo_list/todo_list.mbt` | `Vec[Todo]` and `each`, with `it.index` in place of `sourceKey()`. Out-of-range indexes (random messages) are ignored. |
| composed.js | `composed/composed.mbt` | Prices are cents (`money`), so totals are exact. `t.number().min(0)` is the invariant "the quantity is never negative". `sourceKey: t.index("lines")` is `remove_line.from(lines, …)`. `step.send(…, { at: b.item("lines", 1) })` is `send_to(line, lines.at(1), Step(1))`. Cart has a `Clear` message, because a root target needs one. |
| async.js | `async/async.mbt` | `lookup` is an `Ask[String, String]`, and the reply comes back as `Got(AskResult)`. JS's handler waits 600 ms. Here a story's handler is synchronous (portable to memdom on every target), so the loading state gets a story of its own, "Waiting for the answer", whose handler holds the reply while the steps send it. "Lisbon" and "Atlantis" answer from the table. |
| mistakes.js | `mistakes/mistakes.mbt` + `mistakes/broken/typos.mbt` | See above. A component with `check()` issues can't render (`Component::render_at` aborts on view issues), so `@run.start` fails such a run with the issues listed instead of mounting it. JS shows its lint in the Dev tab while the story runs. |

## The component libraries

JS's `site/playground/examples.js` offers seven libraries after the site examples. All seven are in `examples/playground/examples.js`. Smoke checks each one's file list against its package directories, so the lists can't drift. It then compiles each library in the page and runs every story and every sequence to the end, as for the site examples (`<id>: its stories start valid and pass their sequences in the UI`).

| JS | MoonBit packages, in compile order | Books | Compile (node smoke / Chrome) | Linked JS |
|---|---|---|---|---|
| 🧮 Math | `math` (`{math,mathml,workbench}.mbt`, `@fm` for core math), `math/stories` | `math_book()`, `workbench_book()` | 2.7–3.1 s | 1.9 MB |
| 🗂️ JSON editor | `json_editor` (`json.mbt`), `json_editor/stories` (as `@json`) | `json_book()` | 2.5–2.9 s | 1.8 MB |
| 📐 JSON Schema | `json_editor`, `common` (`clock.mbt`, `files.mbt`), `jsonschema` (`{fixtures,infer,model,studio,views}.mbt`, as `@jv` and `@common`), `jsonschema/stories` (as `@js`) | `schema_book()`, `studio_book()` | 4.9–5.4 s / 4.2–4.4 s | 3.2 MB |
| ✅ Todo app | `todo` (`{app,common,dates,fixtures,project,quickadd,task,using}.mbt`), `todo/stories` | `todo_book()` | 3.0–3.2 s | 2.2 MB |
| 🎨 Drawing | `common`, `drawing` (`{drawing,shapes}.mbt`), `drawing/stories` | `drawing_book()` | 2.8–3.1 s | 1.9 MB |
| 📈 Thing tracker | `common`, the 23 files of `thingtracker`, `thingtracker/stories` (as `@tt`). `text_js.mbt` compiles for js and `text_table.mbt` for wasm-gc, as its moon.pkg `targets` say (`targets` in `examples.js`); the other backend's file shows struck through | `thing_tracker_book()` | 6.3–6.9 s | 4.8 MB |
| 🔍 Dev panel | `json_editor`, `todo`, `devtools` (`stories.mbt`, as `@jv` and `@todo`) | `dev_book()` | 3.6–4.2 s | 2.1 MB |

The site examples compile in 1.6–2.2 s to 1.2–1.4 MB of JS. Smoke prints these numbers each run.

Compiling each package on its own costs more than the textual merge it replaced did, which compiled a library as one package. On js, a library takes 0.4–1.5 s longer (JSON Schema 3.5–3.9 s → 4.9–5.4 s in node, 3.2 s → 4.2–4.4 s in Chrome; the thing tracker 5.3–6.0 s → 6.3–6.9 s). Its JS is 5–15% larger (JSON Schema 2.9 → 3.2 MB, the thing tracker 4.2 → 4.8 MB), because what's private to a package is no longer one package's. The site examples are one package, so they are unchanged.

On wasm-gc, smoke compiles and runs the counter (live clicks, the story kept across runs, every sequence), JSON Schema (on its dependencies, as separate packages) and the thing tracker (with `text_table.mbt`), and the mistakes example's two failures:

| Example | Compile + link (node smoke / Chrome) | wasm |
|---|---|---|
| counter | 3.0–3.1 s / 2.7–2.9 s | 415 KB |
| mistakes | 3.6–3.9 s | 412 KB |
| JSON Schema | 10.5–11.1 s / 9.1 s | 1.15 MB |
| Todo app, Dev panel | — / 5.6 s, 7.3 s | |
| thing tracker | 13.6–15.2 s / 11.2 s | 1.65 MB |

Before the per-package compile, these were 9.2–9.6 s / 6.7–7.3 s for JSON Schema, 12.8–13.8 s / 10.0 s for the thing tracker, and 4.7–4.8 s for Todo and the Dev panel in Chrome.

wasm-gc runs are smaller but compile 1.5–2.5× slower than js. moonc's wasm-gc link builds the module's sections with OCaml's `List.append` (`@`), which isn't tail-recursive: as published, moonc-web.cjs recurses once per element of its left list, about 6,300 frames for the thing tracker when the module's field lists are concatenated under `linkCore`. A worker's stack in Chrome is under half the page's (about 5,200 frames of a small function against 12,200), so the JSON Schema and thing tracker links overflowed it, and in node the thing tracker overflowed the default stack. `scripts/vendor-moonc.mjs` therefore patches the worker as it vendors it: it finds `List.append` by its code's shape (failing unless exactly one function matches, whatever its minified name) and replaces it with a loop that allocates the same `[0, head, tail]` cells in the same order and shares the right list as the last tail. A stack dump at the overflow showed nothing else (6,324 of 6,335 frames were `List.append`; `List.map`, `mapi`, `map2` and `init` are recursive too but never deep there). With the patch the thing tracker links in node on as little as 380 KB of stack; below about 300 KB its type checking overflows, which is ordinary recursion over the program. Every example's js and wasm-gc output is byte-identical to the unpatched compiler's on a large stack. `just smoke` runs the playground smoke on node's default stack, and the browser check fails if a compile falls back to the page: `compiler.js` keeps that fallback (it compiles the run again on the page with a moonc of its own, and the status says "compiled on the page") only for a user's program far larger than the libraries. A moonc instance that linked wasm-gc carries state into its next link (JSON Schema linked after the counter on one instance gives a different .wasm than on a fresh one), so the worker starts a fresh one after each wasm-gc compile (`reusable` in `compile.js`; about 160 ms). The payload and the compiler are rebuilt in place, so the worker fetches them with `cache: "no-cache"`: Chrome once compiled against a stale cached storybook .mi and reported errors the sources didn't have.

The payload is in `examples/playground/payload/<backend>/`, which `scripts/playground-payload.mjs` assembles, one per backend:

| Backend | Files | Size | Gzipped | Cores | Core-library .mi | tutuca-mb .mi |
|---|---|---|---|---|---|---|
| js | 103 | 7.1 MB | 3.1 MB | 5.3 MB | 1.6 MB | 0.17 MB |
| wasm-gc | 103 | 7.8 MB | 3.4 MB | 5.9 MB | 1.7 MB | 0.17 MB |

Each holds only the .mi of its link closure's packages, where before it held every built package's. Dropping `common`, `json_editor` and `todo` took the js payload from 7.5 MB in 108 files to 7.1 MB in 103. The compiler, `deps/moonc-web.cjs`, is another 4.9 MB (1.2 MB gzipped). A page fetches it and the js payload once, in the worker, whatever the number of playgrounds on it. It fetches the wasm-gc payload on its first wasm-gc run.

## Embedded playgrounds

JS's landing page embeds `<tutuca-playground src=...>` elements inline. Here `examples/index.html` embeds five `<tutuca-playground example="counter">` elements (counter, todo-list, composed, async, mistakes). `embed.js` defines the element and `element.js` wires it to the page:
- **Lazy.** Each one loads its files when it connects and compiles when it first scrolls into view (or at once with `eager`), or on Run.
- **One compiler.** Every playground on the page shares one worker, whose queue compiles one run at a time. Runs are imported one at a time too, because a run reads its config from `globalThis.__tutucaPlayground` as it evaluates.
- **Isolated runs.** Each run's previews are keyed `p<playground>r<run>/<story>`. The storybook's UI CSS goes in a `<style id="tutuca-playground-<n>">` of each playground's own: `@web.start` gained `style_id~`, defaulting to `margaui`. Each storybook answers only the `<tutuca-app>` requests under its own root (`on_app_request`).

An embed's `backend` attribute (`js` by default, or `wasm-gc`) picks what its runs compile to, and changing it runs again. Smoke: `an embedded playground's backend attribute picks wasm-gc, and changing it runs again`.

Smoke checks two eager embeds and a lazy one on one page (`two embedded playgrounds run independently; a lazy one waits`):
- distinct prefixes and style elements;
- a click in one preview changes only that one, and only its timeline;
- running one again leaves the other's run mounted;
- the lazy one stays idle until it starts.

In Chrome, the landing page compiled the first embed on load and each later one as it scrolled into view, each with its own prefix and stylesheet. Clicks and typing in two previews stayed apart, and a later embed's run left the earlier ones alone. Smoke can't reach the worker's queue or the IntersectionObserver (jsdom has neither), so those are verified in the browser only.

## Gaps against the JS playground

- **Dependencies are copies.** A library's dependencies are editable, but each library loads its own copy: an edit to `json.mbt` in JSON Schema doesn't reach the JSON editor library or the Dev panel, as in JS, where each playground loads its own sources too.
- **Repeated warnings show once per compiler.** A moonc instance reports a diagnostic text once. A warning that a reused instance has already reported (the same file, unchanged, run again) isn't listed again. Errors are always listed, because a failed compile starts a fresh instance.
- **Compile time.** A run compiles in 2–7 s on js (1.2–4.8 MB of JS) and 3–15 s on wasm-gc. The landing page's five embeds therefore compile one after another as they scroll in, not at once.
- **wasm-gc export names.** A wasm-gc run exports `on_call` (the loader calls it) and `playground_story`. moonc exports every function of an exported name, methods too, so a run that defines a function or method of either name fails to instantiate (it is why the second isn't `current`: the thing tracker has `MeasurementWizard::current`).
- **Toolchain coupling.** The payload comes from the installed moonc, and `scripts/vendor-moonc.mjs` fetches the worker built from the same build (it is looked up on npm by day, then checked by its `+build`). A new toolchain therefore needs network once.
