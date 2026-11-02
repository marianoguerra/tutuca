---
name: css-layout-lab
description: Building CSS Grid and Flexbox layouts from a container and its items, with a live preview, the generated CSS and warnings for unknown properties.
---

# CSS layout lab

Declarations are written as in a style attribute: `grid-area: header; padding: 1rem;`. The
container's display is its own value: `set_container_property("display", "flex")`, and a
display declaration in its CSS is dropped then. `set_container_property(property, "")` removes
a property.

The lab knows the grid, flex and box properties (sizes, margins, paddings, borders, position,
a few text ones) and custom properties (`--x`). Anything else is a warning, with a suggestion
when it looks like a typo.

Workflow:
1. Read the warnings in the summary and fix them.
2. `layout_summary` to check the tracks or the flex direction against what the user wants.
3. Change the container first, then the items that need placing (`grid-area`, `grid-column`,
   `flex`, `align-self`, `order`).
4. `css` to show the stylesheet: `.container { … }` and one rule per item, named by its id.
