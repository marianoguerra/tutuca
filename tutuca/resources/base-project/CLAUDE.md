# Project Instructions

This is a tutuca UI framework project.

Read @.claude/tutuca.md for framework documentation.

## Quick Start

- Components are defined in `src/components.js`
- Run `npm run dev:setup` once to install dependencies
- Run `npm run watch:css` and `npx serve` for development

## Project Structure

```
src/
  app.js        - App initialization
  components.js - Component definitions
  ui.js         - Re-exports from tutuca
style/
  style.css     - Compiled CSS (from Tailwind/DaisyUI)
index.html      - Entry point
```

## Creating Components

Components go in `src/components.js` and must be exported via `getComponents()`:

```javascript
import { component, html } from "./ui.js";

export const MyComponent = component({
  name: "MyComponent",
  fields: { /* state */ },
  methods: { /* pure functions */ },
  input: { /* event handlers */ },
  view: html`<!-- template -->`,
});

export function getComponents() {
  return [MyComponent];
}
```
