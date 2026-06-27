# docs/examples

Example modules used by the tutorial (`docs/tutorial.html`), the index-page
demos (`docs/index.html`), the more-examples gallery (`docs/more-examples.html`),
and the storybook.

Every example follows the same conventional shape (`getComponents`,
`getRoot`, optional `getMacros` / `getRequestHandlers` / `getExamples`) so
the playground, the storybook, and the `tutuca` CLI can all consume them
without per-file glue. See the "Conventional Module Exports" section in
`docs/skill/core.md` for the contract (with `docs/skill/advanced.md` for
drag&drop, dynamic bindings, etc., and `docs/skill/cli.md` for the CLI).

## Categories

The lists below mirror the `<script src>` set each page actually loads — keep
them in sync when adding or moving an example (an example may appear on more
than one page).

### Tutorial examples (small, single-feature)

Embedded in `tutorial.html`. Each demonstrates one tutuca feature. Keep them
minimal: one or two components, no external dependencies, no business logic
beyond what the section is teaching.

`minimum-viable-component.js`, `static-view-component.js`, `text-directive.js`,
`attribute-binding.js`, `counter.js`, `event-modifiers.js`,
`conditional-attributes.js`, `styles-example.js`, `list-iteration.js`,
`list-and-filter.js`, `list-filter-enrich.js`, `list-filter-enrich-with.js`,
`filter-paginate.js`, `render-with-scope.js`, `seq-item-access.js`,
`multiple-views.js`, `push-view.js`, `render-child.js`, `tree.js`,
`request-example.js`, `send-receive.js`, `show-hide.js`, `tabbed-ui.js`,
`dnd-example.js`, `macro-static.js`, `macro-params.js`, `macro-slots.js`,
`macro-named-slots.js`, `danger-set-inner-html.js`, `pseudo-x.js`,
`web-component-custom-event.js`, `dynamic-bindings.js`, `dynamic-path.js`,
`testing-example.js`, `lint-errors.js`.

### Index-page demo apps (multi-component, integrated)

Showcased on the home page (`index.html`). They combine multiple components,
sometimes load remote data, and may pull in external libraries.

`todo.js`, `json.js`, `personal-site.js`, `visual-wasm.js`, `composability.js`,
`storybook.js`, plus tutorial demos reused on the home page (`counter.js`,
`tree.js`, `dnd-example.js`, `filter-paginate.js`, `testing-example.js`,
`web-component-custom-event.js`).

### More-examples gallery (feature showcases)

Embedded in `more-examples.html`.

`todo-macros.js`, `pagination.js`, `file-picker.js`, `mathml-formula.js`,
`traffic-light.js`, `svg-bar-chart.js`, `svg-icon-macro.js`,
`svg-interactive.js`, `dynamic-selected-edit.js` (plus `dynamic-bindings.js`
and `dynamic-path.js`, also used in the tutorial).

`pagination.js` — `@loop-with` returns `{ iterData, start, end }`; the
`start`/`end` slice paginates `@each` without iterating off-page items.

### Doc-referenced (not embedded in a page)

`custom-collection.js` — registers a custom keyed collection with a
`SEQ_INFO` walker so `@each`, `@key` event paths, and `@loop-with` slicing all
work on it. Referenced from "Registering a custom seq type" in
`docs/skill/advanced.md`; not loaded by any HTML page.

### Building blocks

Components reused across other examples — not standalone demos.

`entry.js` — `Entry` component imported by `multiple-views.js` and
`push-view.js`.

### Data

Plain data files, prefixed with `_` so they sort to the top and are easy to
distinguish from examples.

`_shared-data.js` — sample list (Borges' classification of animals) used by
several iteration examples.
