# The render cache

A host renders with a `RenderCache`. `CopyCache`, the default, and `WeakMapCache` reuse what a
component rendered before, when nothing its render depends on changed. `NullCache` renders every view
from the root on every update. `CheckCache` checks a cache against an uncached render. Only the
page's views are cached (`target === null`); other targets always render with `NullCache`.

```js
new Host({ document, rootNode }); // a CopyCache
new Host({ document, rootNode, renderCache: new NullCache() }); // no cache
new Host({ document, rootNode, renderCache: new CheckCache(new CopyCache()) }); // dev, tests
```

## The interface (`src/core/view/render-cache.js`)

```js
class RenderCache {
  get usesSlots()                       // whether renders compute ctx.slot
  get scope()                           // the root ctx's cacheScope
  begin()                               // a render starts
  end(root, target, vdom)               // it rendered vdom for root
  render(instance, spec, view, ctx)     // a component's view between its markers
  fragment(result, wrapped, key, make)  // a renderEach item's fragment
}
```

`renderView` calls `ctx.cache.render(...)`. `loopFragments` calls `ctx.cache.fragment(...)` for
`renderEach` items, so an item whose component render was reused keeps its fragment too, and morph
skips it by identity. `Host.render` calls `begin` and `end` around each render. Every
`RenderContext.root` without a cache gets `NULL_CACHE`, so the other targets' renders and `DepsWalker`
are uncached.

## What a component's render depends on

`renderView(instance, ctx, viewName)` is a function of:

- the **instance**: immutable, so an unchanged one is the same object (Immer shares what a change
  didn't touch);
- the **view** picked for it, and the **view stack** its descendants inherit;
- the **provided values read anywhere in its subtree**, each with how many frames up its provider is.

Not of where it is. The frame markers that say where a component is wrap its render, outside it,
and every marker inside it is relative: a render site or a loop item says its keys and item, and a
frame whose source is a provided value says how many frames up its provider is (`u`), not the
provider's depth. So the same render is right at any depth, and a `WeakMapCache` reuses an instance
moved to another level of a tree.

It doesn't depend on binds: every way into `renderView` starts the component with empty binds.

`DepsCache`, the base of both caching strategies, records what a render read:

- While a view evaluates, `RenderContext.readProvided` notes each name it reads in the component's
  `deps`.
- When a child component finishes, whether it rendered again or was a hit, its deps join its
  parent's, minus the names the child provides itself. Reads of those below it are of the child's own
  provides, which follow from its instance.

So an entry lists every provided value its whole subtree read. A hit needs the same instance in the
same place (view and view stack) and every recorded value unchanged: the same `value` (`===`),
from a provider as many frames up, at the same keys. A value read farther from its provider than
before renders again, even if it's only read as a value. Unchanged inputs render the same and, by induction, read
the same names, so the deps recorded last time are the right ones to check.

`DepsCache` also does three things for both strategies:
- **Static facts.** `viewFacts` says whether a view reads anything provided or renders components.
  A view with neither collects no deps.
- **Churn backoff.** A place whose deps changed twice in a row stops keeping its result, apart from
  one try in 16. A render dropped on the next update costs the GC more than it saves.
- **Loop fragments.** `fragment` reuses a loop item's fragment, through `last`.

Subclasses only say where entries live:
- `find(instance, view, ctx)` gives `{ hit, old }`.
- `keep(entry, ctx, isHit)` keeps an entry for this render.
- `childScope(entry, old)` is what its children render with.

## The strategies

### `WeakMapCache`: entries by instance, while the instance lives

A WeakMap from instance to one entry per place, up to 8 places. Nothing is evicted: an entry goes
when its instance is garbage-collected. An instance shown again after a while renders what it
rendered then: a tab switched back renders nothing.

The cost is memory, whenever old states stay alive. An undo history keeps every past root, and with
it every past root's entry and that entry's whole render. In the worst-case benchmark, where every
item renders again on every update, that's 118 MB for 41 states of a 2000-item list.

### `CopyCache`: the last render's entries, as a tree

Modeled on a copying GC:
- Each render starts an empty tree (`to`) and finds entries in the last one (`from`).
- **A hit moves the old entry into `to` by pointer, with its whole subtree.** Nothing is copied.
- A miss makes a new entry. Its children are found among the children of the entry that was at its
  position.
- Whatever the render didn't reach goes with the old tree. That covers a closed tab, a removed item,
  and a subtree moved under another parent. Memory is the current render's.

The copy has to be per subtree. With one flat map, a hit skips its subtree, so the entries below it
never reach the new map. The next edit inside that subtree would then render all of it again.

An entry's children are kept two ways (`{ byInstance, bySlot }`):
- **By instance**, so an unchanged child is found wherever it moved among its siblings. Reversing a
  list renders nothing.
- **By slot**, its position under the parent. When a child's instance changed, the old entry at its
  position supplies the children to look in. Without it, an edited path would lose its unchanged
  siblings below.

The slot is the marker text of each frame between the parent and the child (a `render` site, a loop
item), joined. It's computed only when `cache.usesSlots`.

The trade-off is that an instance shown again after a render without it renders again: switching a
tab back costs a full render of the tab.

### `CheckCache(inner)`

Renders go to `inner`, which records every entry it hit or made in its `trace`. After each render,
`CheckCache` does two checks:
- It renders again with `NULL_CACHE` and `console.assert`s both renders are the same.
- It walks the tree with `DepsWalker` and asserts each traced component's deps are the ones it finds.

`TUTUCA_RENDER_CACHE` picks the cache of every test host: `none`, `weakmap`, `copy`, `check:weakmap`
or `check:copy`. Unset, test hosts use the Host's default. Under both check modes, every render of the suite matches. One test fails because it
counts how many times loop functions are called, and a check renders three times.

## Two passes: the skeleton walk

Another design finds the dependencies before rendering:
1. Walk only what steers a render (conds, loops, child components) and what reads a provided value.
2. Render, keyed on what the walk found.

`DepsWalker` (`src/dev/deps-walker.js`, exported from `tutuca/dev`) is that walk. It shares `loopEntries` and
`CondNode.branch` with the render, so the two can't drift apart. On its own it must visit every
component on every update, because it can't stop at an unchanged instance without remembering deps.
It costs about half a full render: in the browser, 2.2 ms on top of a cached tree update of 0.1 ms.
So it's the oracle, not a pass.

## Numbers

There are two runners for the same benchmark (`scripts/bench/render.js`). Both report the mean per
update over 40 updates, with every state still alive. Browser clocks move in steps of 0.1 ms, too
coarse to time one cached render.
- **Node on jsdom:** `node --expose-gc scripts/bench-render.js`.
- **A browser on its real DOM:** `just serve`, then `/scripts/bench/render.html`. Here it ran in
  Chromium 157, headless. Heap numbers need Chrome started with `--js-flags=--expose-gc`.

Browser, 2000 items (update = render + morph; render = render alone):

| shape | none | WeakMapCache | CopyCache |
| --- | --- | --- | --- |
| list, one item edited | 12.8 ms (render 3.1) | 5.1 ms (2.0), 2.5x | 6.1 ms (3.1), 2.1x |
| tree of 2047, one leaf edited | 6.4 ms (3.2) | 0.13 ms (0.04), 48x | 0.10 ms (0.03), 64x |
| list reading a provided value, one item edited | 13.2 ms (3.4) | 4.5 ms (2.1), 2.9x | 6.1 ms (3.3), 2.2x |
| two tabs of 2000, switched every update | 4.9 ms (3.1) | 0.7 ms (0.09), 7.0x | 7.5 ms (5.8), 0.6x |
| worst case: every item reads a provided value that changes every update | 19.7 ms (3.4) | 22.3 ms (6.8), 0.9x | 21.6 ms (5.8), 0.9x |

At 5000 items in the browser:
- The list updates 2.4x faster with WeakMapCache and 2.0x with CopyCache.
- The tree updates 103x and 125x faster.
- The tabs update 3.6x faster with WeakMapCache and 0.8x as fast with CopyCache.
- The worst case is 0.9x with both.

jsdom's DOM is slower than a browser's, so its gains are smaller: the list updates about 1.7x faster
and the tree about 29x. It does measure the heap each cache holds after the 40 updates:

| shape | WeakMapCache | CopyCache |
| --- | --- | --- |
| list, one item edited | 1.8 MB | 0.9 MB |
| tree, one leaf edited | 1.3 MB | 1.4 MB |
| two tabs, switched | 3.8 MB | 3.4 MB |
| worst case | 118.5 MB | 4.8 MB |

What the numbers say:
- **Small edits.** Both caches win clearly, and the win grows with the tree. The lists gain less
  because the list's own instance changes, so its loop runs over every item again.
- **CopyCache is slower on a re-rendered parent with many children.** It re-keeps every child in
  two maps per render: about 1 ms per 2000 children here.
- **Tab switches favor WeakMapCache.** CopyCache re-renders the tab: that's its trade-off.
- **Memory favors CopyCache.** It holds the last render, while WeakMapCache holds everything any live
  state rendered: 118 MB against 4.8 MB in the worst case.
- **The worst case is within about 10%** of no cache with both.

## Open

- CopyCache is the default because it bounds memory to the last render. WeakMapCache is the choice
  for a UI that goes back and forth between large views, as long as it doesn't keep old states alive
  (undo histories, `src/history`).
- The other targets (tui, md, js, llm, ps, docx) need a check that their lowering never mutates a
  vnode before they're cached.
