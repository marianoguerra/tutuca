# Tutuca storybook — living feature reference

A curated set of `*.dev.js` modules that exercise **every** storybook feature. It is
both a manual smoke test and a copy-paste reference for authors. It is published at
**https://marianoguerra.github.io/tutuca/storybook/** and runs live with one command.

## Run it

```sh
npm run storybook          # rebuild local runtime, serve this folder (http://localhost:4321)
npm run storybook -- --port 5000   # extra args are forwarded to `tutuca storybook`
```

The live serve uses the freshly built local runtime, so the newest features
(lifecycle `on`, `drive`) work immediately. The published page uses the CDN
(`tutuca@latest`); the `on`/`drive` demos there light up only after the next npm
release (a note on the page says so). Everything else works on both.

## What each module shows

| File | Feature(s) |
| --- | --- |
| `01-basics.dev.js` | `getComponents` + `getExamples` (single section); item `title`/`description`/`value`; one item per state = a state matrix |
| `02-sections.dev.js` | `getExamples` returning an **array of sections**; title sorting; sidebar fuzzy filter (section + example level) |
| `03-views.dev.js` | named `views` + `@push-view`; the per-example `view` field; `<x render as="...">` |
| `04-macros.dev.js` | `getMacros` — static, params (static + dynamic), default slot, named slots |
| `05-requests.dev.js` | `getRequestHandlers` (real) + per-example `requestHandlers` mocks: fixture / error / loading-forever / real |
| `06-lifecycle-on.dev.js` | the **`on`** field: `init`/`resume`/`suspend`; kinds `send`/`request`/`input` (+ `do`, + `args` as `(self)=>[...]`); a live message log makes navigation visible |
| `07-tests-drive.dev.js` | `getTests` with `describe`/`test`/`expect` + the **`drive(value, phase, opts)`** helper; `alter` handlers tested directly |
| `08-getroot-inception.dev.js` | `getRoot` (standalone root state); the engine (`Storybook`/`Section`/`Example`) rendered as components ("Inception") |
| `_shared.js` | shared fixtures (plain `.js`, ignored by discovery) |

To see `suspend`/`resume`: open **06**, watch the cards log `init`, click another
section in the sidebar, then come back — the last card logs `suspend` then `resume`.

Run the terminal-side tests with `tutuca test docs/storybook/07-tests-drive.dev.js`
or see them all via `tutuca storybook --dry-run docs/storybook`.

## Known gaps / unification roadmap (follow-up)

This folder is the canonical, Pages-correct storybook. Three pre-existing things are
left to a separate refactor:

- **Three duplicate `Example` renderers** — the engine's `Example` (`src/storybook.js`),
  `docs/src/universal.js`'s own `Example`, and the playground preview
  (`docs/src/playground.js`) all render the same `{title,description,value,view}`
  shape. Collapse onto the engine's `Example`/`Section`.
- **`docs/storybook.html` is broken on Pages** — it imports `../dev.js` /
  `../storybook.js` (outside the published `docs/` root). This `/storybook/` page
  supersedes it; the old page should be removed or repointed.
- **Three test entry points** — playground in-browser `getTests`, CLI `runDevTests`,
  and `npm test`. A unified surface would expose one.

Target: one playground that renders this storybook gallery and adds the
editor/lint/test/API-docs tabs as the focus view. See `TODO.md`.
