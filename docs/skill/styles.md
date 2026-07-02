# Tutuca — Styles

Read this file when authoring `style` / `commonStyle` / `globalStyle`
blocks or debugging CSS that silently doesn't apply.

```js
component({
  style:       css`.mine { color: red; }`,        // scoped to main view
  commonStyle: css`.shared { color: yellow; }`,   // scoped to all views of this component
  globalStyle: css`.app-thing { color: green; }`, // global, no scoping
  views: {
    two: { view: html`...`, style: css`.mine { color: orange; }` },
  },
});
```

Tagged templates `html` and `css` are just `String.raw` (editor hinting
only). Plain strings work too.

`style` and `commonStyle` are wrapped in a component-scoped selector
(`[data-cid="N"]{ … }`), so their CSS lands *inside* a style-rule block.

A useful consequence: **bare declarations with no selector** (e.g.
`color: red; padding: 1rem;`) land directly inside that wrapper, so they style
the component's **root element** — the host node carrying `data-cid` (plus
`data-vid` for a per-view `style`). Reach for this to style a component's own
outer element without adding a wrapper selector; nested rules with a selector
(`.mine { … }`) target descendants instead.

Because the CSS sits inside a style-rule block,
top-level-only constructs break there and the browser silently drops them —
put them in `globalStyle` (injected verbatim, no wrapper) instead:

- Non-nestable at-rules: `@import`, `@charset`, `@namespace`, `@font-face`,
  `@keyframes`, `@page`, `@property`, `@counter-style`, `@font-feature-values`,
  `@font-palette-values`, `@view-transition`. (Conditional group rules —
  `@media`, `@supports`, `@container`, `@layer`, `@scope`, `@starting-style` —
  *do* nest and stay in `style`/`commonStyle`.)
- Rules whose leading selector is `html`, `body`, or `:root`: once scoped they
  become descendant selectors that never match.

The linter flags both (`TOP_LEVEL_AT_RULE_IN_SCOPED_STYLE`,
`GLOBAL_SELECTOR_IN_SCOPED_STYLE`). For a genuine false positive, put a
`/* tutuca-lint-ignore */` comment on the same line as the flagged construct.

For Tailwind / MargaUI utility classes (compiling `class=` literals into
CSS via the extra build) and the `compileClassesToStyleText` + `injectCss`
wiring, see [margaui.md](./margaui.md).
