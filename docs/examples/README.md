# docs/examples

Example modules used by the tutorial (`docs/tutorial.html`), the index-page
demos (`docs/index.html`), and the storybook.

Every example follows the same conventional shape (`getComponents`,
`getRoot`, optional `getMacros` / `getRequestHandlers` / `getExamples`) so
the playground, the storybook, and the `tutuca` CLI can all consume them
without per-file glue. See the "Conventional Module Exports" section in
`docs/skill/core.md` for the contract (with `docs/skill/advanced.md` for
drag&drop, dynamic bindings, etc., and `docs/skill/cli.md` for the CLI).

## Categories

### Tutorial examples (small, single-feature)

These each demonstrate one tutuca feature and are embedded in
`tutorial.html`. Keep them minimal: one or two components, no external
dependencies, no business logic beyond what the section is teaching.

`minimum-viable-component.js`, `static-view-component.js`,
`text-directive.js`, `attribute-binding.js`, `counter.js`,
`event-modifiers.js`, `conditional-attributes.js`, `styles-example.js`,
`list-iteration.js`, `list-and-filter.js`, `list-filter-enrich.js`,
`list-filter-enrich-with.js`, `filter-paginate.js`, `render-with-scope.js`,
`seq-item-access.js`, `multiple-views.js`,
`push-view.js`, `tree.js`, `request-example.js`, `dnd-example.js`,
`macro-static.js`, `macro-params.js`, `macro-slots.js`,
`macro-named-slots.js`, `danger-set-inner-html.js`, `pseudo-x.js`,
`web-component-custom-event.js`, `dynamic-bindings.js`,
`dynamic-path.js`, `dynamic-selected-edit.js`, `lint-errors.js`.

### Index-page demo apps (multi-component, integrated)

Larger demos showcased on the home page. They combine multiple components,
sometimes load remote data, and may pull in external libraries.

`todo.js`, `todo-macros.js`, `json.js`, `personal-site.js`,
`visual-wasm.js`, `composability.js`, `storybook.js`.

### More-examples gallery (feature showcases)

Embedded in `more-examples.html`.

`pagination.js` — `@loop-with` returns `{ iterData, start, end }`; the
`start`/`end` slice paginates `@each` without iterating off-page items.

`custom-collection.js` — registers a custom keyed collection with a
`SEQ_INFO` walker so `@each`, `@key` event paths, and `@loop-with`
slicing all work on it (see "Registering a custom seq type" in
`docs/skill/advanced.md`).

### Building blocks

Components reused across other examples — not standalone demos.

`entry.js` — `Entry` component imported by `multiple-views.js` and
`push-view.js`.

### Data

Plain data files, prefixed with `_` so they sort to the top and are easy to
distinguish from examples.

`_shared-data.js` — sample list (Borges' classification of animals) used by
several iteration examples.
