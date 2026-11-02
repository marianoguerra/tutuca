# Grid and Flexbox properties

## Container

| property | grid | flex |
|---|---|---|
| `grid-template-columns`, `grid-template-rows` | tracks: `1fr 2fr`, `repeat(3, 1fr)`, `repeat(auto-fill, minmax(10rem, 1fr))` | — |
| `grid-template-areas` | named regions: `"header header" "nav main"` | — |
| `grid-auto-flow` | `row`, `column`, `dense` | — |
| `flex-direction` | — | `row`, `column`, `row-reverse`, `column-reverse` |
| `flex-wrap` | — | `nowrap`, `wrap` |
| `justify-content` | the grid in its box | items along the main axis |
| `align-items` | items in their cells (block axis) | items across the main axis |
| `gap`, `row-gap`, `column-gap` | between tracks | between items |

## Items

| property | use |
|---|---|
| `grid-area` | a named area, or `row-start / col-start / row-end / col-end` |
| `grid-column`, `grid-row` | `1 / 3`, `span 2`, `1 / -1` (the whole row) |
| `flex` | `1` (grow), `none` (fixed), `0 1 12rem` (grow shrink basis) |
| `align-self`, `justify-self` | one item's alignment |
| `order` | moves an item without changing the markup |
| `margin-left: auto` | pushes a flex item and the ones after it to the end |
