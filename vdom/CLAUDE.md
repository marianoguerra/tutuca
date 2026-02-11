# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This project uses [just](https://github.com/casey/just) as a command runner.

| Command | Description |
|---------|-------------|
| `just` | Run tests (default) |
| `just test` | Run all tests |
| `just test-watch` | Run tests in watch mode |
| `just test-file <file>` | Run a specific test file |
| `just lint` | Lint source and test files |
| `just fmt` | Format source and test files |
| `just check` | Lint + format |
| `just typecheck` | Type-check TypeScript files |
| `just ci` | Run all checks (lint, format, typecheck, test) |
| `just install` | Install dependencies |
| `just dist` | Build distribution files (ESM, minified, types, gzip, brotli) |
| `just serve` | Build and serve playground at http://localhost:3000/tools/playground/ |
| `just stresstest [iterations] [seed]` | Run stress tests (default 100k iterations) |

## Architecture

This is a virtual DOM implementation library written in TypeScript.

### Source Files
- `src/vdom.ts` - Core virtual DOM implementation
- `src/types.ts` - Type definitions (Props, DomOptions, ReorderMove, InsertMove, Moves, Warning, DuplicatedKeysWarning, NewKeyedNodeInReorderWarning)
- `src/dom-props.ts` - DOM property management (applyProperties, isHtmlAttribute, removeProperty, patchObject)

### Virtual Node Types (VBase hierarchy)
- `VText` - Text nodes (nodeType 3)
- `VComment` - Comment nodes (nodeType 8)
- `VFragment` - Fragment containers for multiple children (nodeType 11)
- `VNode` - Element nodes with tag, attrs, childs, key, and namespace (nodeType 1)

### Patch Types (PatchBase hierarchy)
Used for diffing/reconciliation operations:
- `PatchText`, `PatchComment` - Content updates
- `PatchRemove`, `PatchInsert` - Node addition/removal
- `PatchReorder` - Child reordering with keyed reconciliation
- `PatchNode` - Element replacement
- `PatchProps` - Property/attribute updates

### Core Classes and Functions
- `h(tagName, properties, children)` - Hyperscript helper for creating VNodes
- `VBase.toDom(options)` - Creates real DOM nodes from virtual nodes
- `VBase.diff(other)` - Computes a `PatchPlan` to transform this virtual tree into `other`
- `PatchPlan.applyTo(rootNode, options)` - Applies patches to a real DOM tree
- `render(vnode, container, options)` - Renders a virtual DOM tree into a container element
- `unmount(container)` - Clears render cache and container contents

### Key Implementation Details
- Keyed children are reconciled efficiently using the `key` property
- Namespace support for SVG and other namespaced elements
- `style` is a plain CSS string (e.g. `"color: red; padding: 5px"`), diffed and applied like any other string prop
- `attributes` are handled specially during patching

### Test Infrastructure
- Test framework: Bun's built-in test runner (`bun:test`)
- Property-based testing with `fast-check`
- DOM testing with `jsdom`
- `tests/vdom.spec.ts` - Main test suite
- `tests/genutil.ts` - Utilities for generating random VNode trees and mutations

### Tools
- `tools/stresstest.js` - Stress testing with configurable iterations and seed
- `tools/playground/index.html` - Interactive playground for visualizing virtual DOM operations

## Code Style

Biome is configured with:
- 2-space indentation
- Double quotes for strings
- 90 character line width
- Auto-organize imports enabled

## Development Workflow

After each change, run tests and check types:
- `just test` - Run all tests to ensure nothing is broken
- `just typecheck` - Type-check TypeScript files
- `just check` - Run linting and formatting checks