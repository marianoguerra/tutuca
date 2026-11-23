# Tutuca

A small framework for web apps in the browser, small enough to read in full, for people and for
coding agents.

Tutuca covers components, typed state, rendering and event handling, and the tools to check them:
tests that run without a browser, property-based tests generated from your field types, a
storybook with stress tests, and a linter. State changes can be saved or shared with other tabs
and devices through sync engines you plug in ([`docs/sync.md`](docs/sync.md)). A formal model of
the semantics is being written in PLT Redex (`spec/`). The core is about 4,000 lines of
JavaScript with no npm dependencies (it includes a copy of immer).

- Site: https://marianoguerra.github.io/tutuca/
- Storybook: https://marianoguerra.github.io/tutuca/storybook.html

## Install

```sh
npm install tutuca
```

Or from a CDN, without a build step:

```js
import { component, h, Host } from "https://cdn.jsdelivr.net/npm/tutuca/dist/tutuca.min.js";
```

## Example

```js
import { component, field, h, Host, send, t } from "tutuca";

const Counter = component({
	name: "Counter",
	fields: { count: t.number() },
	view: h("button", { "on:click": send("inc") }, "Clicked ", field("count")),
	on: {
		inc(next) {
			next.count += 1;
		},
	},
});

const host = new Host({ document, rootNode: document.getElementById("app") });
host.scope.register({ Counter });
host.start(host.scope.components.Counter());
```

## Modules

| Import | What |
|---|---|
| `tutuca` | components, views, schemas, the host, the `tag` and `button` element builders |
| `tutuca/dev` | Dev mode: the `DevChecks` a `Host` runs (`new Host({ checks: DevChecks })`), DevTools formatters (`installFormatters`), `CheckCache` (checks a render cache against an uncached render), `DepsWalker` (the provided values a subtree reads), `pathTree` and `pathTreeText` |
| `tutuca/tree` | the routing core on its own: paths, addresses, tasks, watches and the `Scheduler` |
| `tutuca/meta` | the meta conventions a component can follow: classes, display, data and agent |
| `tutuca/history` | time travel: `Timeline` and `historyEngine` |
| `tutuca/history/bar` | the `TimeTravel` bar component |
| `tutuca/lint` | the linter |
| `tutuca/pure` | (experimental) handlers and whole components as checked source text (bring your own `pure-js`): `enableHandlerSources(pureHandlers())` lets a handler's `run` be pure-js source, and `componentModule(source)` loads a component written as a pure-tutuca module |
| `tutuca/classes` | `collectClasses`, `classUsesOf`, `classNamesOf` and `ClassCompiler`, for CSS compilers that need class names listed. A component whose views compute a class (a field, query or bind in `class`) lists every class it can be in its classes meta, `meta: { [CLASSES_META]: { classes: "a b c" } }` (`CLASSES_META` is in `tutuca/meta`); lint warns with `undeclared-dynamic-class` when it doesn't |
| `tutuca/testing` | the headless driver: `Driver` (send, answer, fire, drag), `testEnv` |
| `tutuca/pbt` | property-based testing on the driver (bring your own `fast-check`) |
| `tutuca/storybook` | the storybook |
| `tutuca/playground` | the `<tutuca-playground>` element: edit a book of stories and run it live (bring your own CodeMirror) |
| `tutuca/element` | the `<tutuca-app>` custom element |
| `tutuca/vdom` | the virtual DOM |
| `tutuca/tui` | tutuca apps in a terminal (opt in: `enableTargets(tuiTarget)`, from `tutuca/tui/target` to declare without the terminal): a component's `renders.tui` (one tree, or views by name with a `main`) is what it renders there, as its `view` (and `views`) is on a page. `runTui({ components, root })` runs one (`node scripts/tui.js counter` runs an example); `startTui` makes one without a terminal, for tests; `tutuca/tui/element` is the `<tutuca-terminal>` element, a terminal preview of an app on a page (`defineTutucaTerminal(window)`) |
| `tutuca/tui/canvas` | the same `renders.tui` on a canvas (the Canvas 2D API: a page's, an `OffscreenCanvas`, a Skia-backed one in Node), with the terminal's hit testing, focus, inputs, scrolling and layers. `mode: "grid"` lays out in cells drawn as pixels, borders as lines; `mode: "text"` (the default) lays out in pixels with a proportional font, attributes still in cells and scaled to the typeface. `startCanvas` and `mirrorCanvas` as `startTui` and `mirrorTui`; `CanvasPainter` and `canvasMetrics` to paint a `Screen` yourself; `tutuca/tui/canvas-element` is `<tutuca-canvas>` (`defineTutucaCanvas(window)`) |
| `tutuca/jsast` | (experimental) components that render JavaScript (opt in: `enableTargets(jsTarget)`, with `js` from `tutuca/jsast/target` to declare without the printer): a component's `renders.js` is an ESTree built with `js.FunctionDeclaration(...)` tags; `renderJs(instance)` prints it (astring) |
| `tutuca/mdast` | (experimental) components that render markdown (opt in: `enableTargets(mdTarget)`, with `md` from `tutuca/mdast/target` to declare without the printer): a component's `renders.md` is an mdast tree built with `md.Heading(...)` tags; `renderMd(instance)` prints it as GFM (mdast-util-to-markdown) |
| `tutuca/ps` | (experimental) components that render PostScript (opt in: `enableTargets(psTarget)`, with `ps` from `tutuca/ps/target` to declare without the printer): a component's `renders.ps` is a drawing (`ps.Page`, `Group`, `Rect`, `Circle`, `Line`, `Polyline`, `Path`, `Text`) in points from the bottom left; `renderPs(instance)` prints it as a DSC PostScript document a printer, `gs` or `ps2pdf` reads |
| `tutuca/pdf` | (experimental) the same drawing as a PDF: `renderPdf(instance)` prints a component's `renders.ps` with PDFKit (vendored as `deps/pdfkit.js`), in browsers and node, to the bytes of a PDF; text is in the 14 standard fonts, or in TrueType/OpenType fonts given by name (`{ fonts: { Inter: bytes } }`), embedded |
| `tutuca/docx` | (experimental) components that render Word documents (opt in: `enableTargets(docxTarget)`, with `docx` from `tutuca/docx/target` to declare without docx): a component's `renders.docx` is a document (`docx.Section`, `Heading`, `Paragraph`, `List`/`ListItem`, `Table`, `Code`, inline `Strong`, `Link`, ...); `renderDocx(instance)` makes the .docx file's bytes with docx (vendored as `deps/docx.js`) |
| `tutuca/llm` | (experimental) components a model can read and use (opt in: `enableTargets(llmContextTarget, llmToolsTarget)`, tags from `tutuca/llm/target`): `renders.llmContext` is markdown for a context window (`Section`, `Fact`, `Items`, `Hint`, `Data`), printed by `renderLlmContext`; `renders.llmTools` is tool definitions (`Tool`, `Str`, `Enum`, ...), `renderLlmTools` gives them with JSON Schema inputs and `callLlmTool(host, { name, input })` checks and runs a call; `When`/`Unless`/`Choose` make both follow the state |
| `tutuca/sync` | sync engines: projection, schema-guided diff, ops, `startSynced`, `storageEngine` |
| `tutuca/sync/remote` | an engine that sends diffs to a remote and applies the ones it sends |
| `tutuca/sync/automerge` | an engine over an Automerge document (bring your own `@automerge/automerge`) |

## Docs

- [`docs/paths.md`](docs/paths.md): how key paths, dispatch paths and selectors route messages.
- [`docs/sync.md`](docs/sync.md): persisting and syncing state with sync engines.
- [`docs/render-cache.md`](docs/render-cache.md): the render cache, what a render depends on, and its benchmark.
- [`docs/pure.md`](docs/pure.md): handlers and components as pure-js source text.
- [`spec/README.md`](spec/README.md): the formal semantics in PLT Redex and how it maps to `src/`.

Projects in this repository with their own README:

- [`pure-js/`](pure-js/README.md): the checked subset of JavaScript and TypeScript `tutuca/pure` reads.
- [`spec/pure-tutuca/`](spec/pure-tutuca/README.md): the format of a component written as a pure-js module.
- [`tutuca-wasm/`](tutuca-wasm/README.md): tutuca's runtime in WebAssembly, over components pure-js compiles.
- [`tdata/`](tdata/README.md): a message format (JSON and CBOR) and tq, its query language.
- [`grow/`](grow/README.md): tutuca's core and its Redex model rebuilt one concept per step.

## Development

Tasks are in the `justfile`; `just` lists them.

```sh
just install    # npm install
just check      # lint, then test
just storybook  # serve the storybook from the repo
just site       # build the site (landing page, storybook, demos, spec PDF) into _site/ and serve it (needs Racket)
just smoke      # build dist/ and check what would be published
just publish    # publish to npm as latest
```

## License

MIT
