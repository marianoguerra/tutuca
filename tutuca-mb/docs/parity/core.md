# Parity: test/core

**Assertion audit:** every row that was marked ported (55) was checked assert by assert against its MoonBit test. **43 same**, **8 strengthened** and **4 reclassified**: 2 became divergent, and 2 parameterized rows were split into a ported part and a divergent part. Now there are 53 ported rows, all audited: 45 "audited: same" (the 43, plus the ported halves of the 2 split rows) and 8 "audited: strengthened". The "Assertions" column gives each row's result. Where an audited-same row keeps a documented divergent detail, the column names it.

This covers every `test()` in `test/core/*.test.js`: 78 call sites, and a parameterized site counts once, except two split by case (view precedence, and the collection modes), which makes 80 rows. **53 are ported**, **18 hold by types** and **9 are divergent**. None are missing. The ports are whitebox tests of `marianoguerra/tutuca` in `jsport_core_<file>_wbtest.mbt`. Shared helpers are in `jsport_core_helpers_wbtest.mbt`. Most "by types" rows are field schemas (`t.*`), loop or scope names, and message names or args, which are struct fields, closures and enum variants here. The divergent rows come from these differences, the first four from the README's intentional differences:
- There is no component registry, because components are values.
- `each` has no source keys.
- Shared templates get an id per use.
- `t.index` is an invariant.
- Loop iterations have no metadata comments.
- Elements with handlers and `if_` are never prebuilt.
- The IR walk visits structure, not attribute or handler nodes.
- An explicit view a child lacks is a check error, not a fallback.

Porting turned up one runtime fix: the shared closing metadata-comment vnode (see `constant.test.js`). Some ports keep a divergent detail inside an otherwise ported test, and their notes say which.

## composition.test.js → `jsport_core_composition_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| literal hello/42/false/null works in scope and each bodies (×4) | ported | `literal hello, 42, false and null work in scope and each bodies`. 42 and false are `txt("42")`/`txt("false")`, since `txt` takes a String. null is `empty()`. | audited: same |
| view precedence: … (×6) | ported | One test per case, `view precedence: [...]`: `["compact",["wide"]]`, `[null,["missing","compact","wide"]]`, `[null,[]]`, `[null,["null","wide"]]`, `["main",["wide"]]`, `[null,["main","wide"]]`. | audited: same (each renders JS's expected text) |
| view precedence: … with an explicit view the child lacks (×3) | divergent | `["missing",["wide","compact"]]`, `["missing",["missing"]]`, `["toString",[]]`: an explicit view the child lacks is refused by `Component::check` ("Child has no view `missing`; use one of: main, compact, wide, null"), so the JS fallback to the stack (`wide`, `default`, `default`) can't render. The tests of those names assert the exact check issue, and that the same stack without the explicit view renders JS's text. | — |
| `${field,seqItem} ${array,object} collection: ${renderEach,renderIt}` (×8) | ported | `{field,seqItem} {array,object} collection: renderEach, each, renderIt, iter` (4 tests, each running all 4 modes). Arrays are `items` over a `Vec`, objects are `entries` over a `SortedMap`, and `seqItem` is a partial lens on the selected group `.then_items(...)`. The JS `frame` metas are checked as component paths in the metadata comments (`.items[0]`, `.groups.selected["a"]`). | audited: same (text `AB`, and one frame per key with JS's prefix and key, in order) |
| `${field,seqItem} ${array,object} collection: ${each,iter}` (×8) | divergent | Same tests. The text JS expects (`01`, `ab`) is asserted, but JS also asserts one `frame` meta per loop iteration, and loop iterations here have no metadata comments (only components do), so the test asserts there are none. `iter` is a custom iterator in each's source. | — |
| render(seqItem) is a frame selecting the item | ported | same name (`render_key`, path `.tabs[1]`) | audited: same (JS's component/frame/component metas are the paths `·`, `.tabs[1]`) |
| loop key, filter, prepare and enrich are called on the component | ported | same name. prepare, filter and enrich are code in each's source and read the component's state. Also checks `key=` calls and the DOM moves on reorder. | audited: strengthened (the prepared count now reaches `key` as JS's `state.count`: key calls are `(0, a, 3)`, `(2, c, 3)`, and the title is built from it) |
| renderIt clears local binds while the outer scope keeps them | by types | A rendered child's view is `View[C, CM]`, so it reads only its own state `C`. A scope's `With[X, Y]` can't flow into it. | — |
| t.component defaults to a fresh instance from the owner's scope | divergent | No registry: a child field is a typed struct field, and its default is the struct's `Default`. Swapping an implementation "registered under a name" means passing another `Component` value to `render`. `specOf`/`scopeOf` have no counterpart. | — |
| t.component rejects values registered under a different name | by types | A child field has the child's state type, so another component's state (or a plain object) doesn't compile. | — |
| register returns factories bound to its scope, and child scopes fall back to parents | divergent | Components are values with no `register`/factories, and `Scope` only holds ask handlers. Scope fallback to parents is covered by `asks resolve through the scope: missing, sync, later` (`runtime_wbtest.mbt`). | — |
| a required component field without a default fails with its path | by types | Building a struct requires every field, so a missing child is a compile error rather than a runtime one. | — |

## constant.test.js → `jsport_core_constant_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| isConstant: literals, elements with constant parts and constant conditions | divergent | Two of JS's four constants aren't constant here: an element with handlers binds them per render (its `data-h` names the instance), and `if_` takes a closure, so there's no literal condition to fold. The test of the same name asserts the two literal elements lower to `PConst` and these two don't. | — |
| isConstant: anything reading the ctx makes it and its ancestors dynamic | ported | same name. Custom `AstNode` subclasses have no counterpart; a custom `Ext` lowers to whatever plan it makes. | audited: strengthened (added `$if(true, field, …)` and a loop-key reader, JS's `sourceKey()`, as an `each` body) |
| a constant element evaluates once without a ctx and returns the same vnode | ported | same name: two hosts with different states share the one prebuilt `<p>` vnode. | audited: strengthened (asserts the `<p>` view lowers to one prebuilt `PConst` `<p>` vnode, besides the cross-host identity) |
| constant subtrees keep their vnode identity across renders | ported | same name (vnode and DOM identity) | audited: same |
| handlers inside constant elements still dispatch, also per loop item | ported | same name. Divergent detail: each item's button is its own vnode (`·#2[0]`, `·#2[1]`, …), not one shared vnode. | audited: same for dispatch (2 clicks → count 2, output 2, second pick → `b`). JS's "all pick buttons are one vnode" is the documented divergent detail and is asserted the other way. |
| walkers still see the attrs of constant elements | ported | same name (`Ir::class_names` of a constant view) | audited: same |
| meta closing comments are one shared vnode across positions and renders | ported | same name. Loop items carry no metadata comments here, so the test renders components with `render_each`. **Runtime fix:** `component.mbt` built a new `Comment(meta_close)` for each render. It now shares `meta_close_vnode` (`meta.mbt`). | audited: same (3 closing comments, then all shared after the re-render; the count after it, 4, is also asserted) |
| literal text children of dynamic elements keep their vnode across renders | ported | same name | audited: same |

## dev-mode.test.js → `jsport_core_dev_mode_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| findInvalidFields reports invalid and undeclared fields with their paths | by types | Field values are typed struct fields, and a struct has no undeclared fields. Runtime constraints are invariants, which the next rows port. | — |
| findInvalidFields skips subtrees shared with the previous state | ported | same name: a child whose state is the same object reuses its checked render, so its broken invariant is reported once. | audited: same (shared broken child: reported once with no previous state, not again when it is shared) |
| dev mode checks the root on start and the state after each task | ported | same name. Schema breaks are invariant breaks here. Divergent detail: `StateInvalid` is reported once the queue is empty and names no task. | audited: same for the issues, their paths and order, and no rollback. JS's `task.name` (`inc`, `rename`) can't be asserted: reports name no task (documented). |
| dev mode reports an invalid root on start, and nothing runs without dev | ported | same name | audited: same |
| dev mode reports messages that break their spec | ported | same name: `pre` and `post`. `args` is the variant's typed payload, so "bad arg" can't be written. `emits` has no counterpart, because signals are typed keys any handler may notify (README: "Signals replace `emits`"). | audited: same for `post` and `pre`. `arg:0` and `emits:*` have no counterpart (documented). |

## each.test.js → `jsport_core_each_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| registration snapshots the loops | by types | There is no mutable `loops` options object. A loop's key, filter and enrich are closures captured in the view, which is lowered once. | — |
| XEach keyWith preserves nodes and refreshes event index metadata after reorder/filter | ported | same name (the source index travels in the item, so `pick` gets the current index) | audited: same |
| adjacent keyed XEach loops have independent key scopes | ported | same name | audited: same |
| XEach rejects duplicate compared keys | ported | same name: the host reports `RenderFailed("Duplicate sibling key: duplicate")` (JS throws), and the DOM stays as it was. | audited: same (a report instead of a throw; the DOM is unchanged) |
| XEach supports object sources, text, conditional empty output and multiple roots | ported | same name. The object source is an iterator of (key, value) pairs keyed by key. Divergent detail: loop iterations have no metadata comments, so the test asserts none instead of 8. | audited: same for reorder `[b, a]`, filter `[b]` and restore (2). JS's 8 iteration comments are the documented divergent detail (asserted 0). |
| lint rejects loop and scope names the component does not declare | by types | `each`/`scope` take closures, not names, so there is no name to misspell. | — |
| loops run on the component, not on the item, inside nested each | ported | same name (`it.up.up.prefix`) | audited: same |
| XEach defaults to source keys without keyWith | divergent | `each`'s source is an `Iter[T]` with no keys, so without `key=` an item is keyed by its position. `render_each` over a keyed collection does default to the item's key, and that part is ported (`same name`: removing `a` keeps `b`'s node). | — |

## events.test.js → `jsport_core_events_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| the default walker walks parents first, attributes before children and handlers | divergent | Attribute values and handler arguments are closures, not nodes, so `Ir::walk` visits only structure: JS's 14-node order (`Cond`, `Field`, `Const`, …, `Send`, `Field`) has no counterpart, and "attributes before children and handlers" can't be observed. The test of the same name asserts the parent-first structural order (`IElem`, `IEach`, `IScope`, `IPushView`, `IElem`, `IShow`) and the element's recorded dynamic attribute and event names. | — |
| Walker reads children of custom nodes through childNodes | ported | same name: a custom node is an `Ext` that states its `Ir`, and the walk follows it. | audited: same (`Listed`→an `Ext` stating `IScope`, `Opaque`→its leaf) |
| elements with handlers get unique IDs, and the spec maps them without copying | ported | same name: `data-h` ids, `Host::handler_sites`, `Component::event_names` | audited: strengthened (fires each site and asserts it sends its own messages in order: `list`, `a`, `c`, `d`, as JS's `actionNames` per eid). "Without copying" holds by types. |
| compilation collects handlers in attributes and children, not in action arguments | ported | same name: both `if_` branches are collected. Attribute values and messages are typed values, so a view can't sit in them. | audited: strengthened (renders both branches and fires `parent`, `yes`, `child`, then `no`, as JS's per-node `actionNames`). The action-argument half holds by types. |
| shared templates keep one ID across views and components | divergent | A view is a value lowered where it is used, so a shared template gets an id per use (`·#2` in main, `·#3` in compact, `·#1` in another component). The test of the same name checks that it dispatches in each place. | — |
| rendering adds data-eid only to elements with handlers | ported | same name (`data-h`) | audited: same |
| a click runs the handler on a draft and re-renders the produced state | ported | same name (the starting state is untouched because it is immutable) | audited: same (frozenness holds by types) |
| targetValue reads values and checkbox state | ported | same name (`on_input` on a checkbox reads `checked`) | audited: same |
| a handler's return value replaces the component | ported | same name (`update` always returns the next state) | audited: same |
| a throwing handler keeps the state and reports taskFailed | ported | same name | audited: same |
| only own message handlers run | by types | Messages are an enum matched by `update`, so there is no `"toString"` handler name to dispatch. | — |
| events on the host, unmanaged children and unknown IDs are ignored | ported | same name | audited: same |
| look-alike meta comments from unmanaged DOM are skipped | ported | same name. First the foreign comment goes where the re-render doesn't morph; then in JS's place, right before the button in the root. The morph, like JS's, assumes managed containers hold no foreign nodes: with one in a morphed child list, JS's morph throws and the MoonBit one misplaces nodes. JS's test asserts only the routing, as this one does. | audited: strengthened (added JS's exact placement: the comment right before the button in the root's child list, one click → count 1) |
| all views of one instance render together and route to it | ported | same name, including the nonmatching inner group. A variant is also in `paths_wbtest.mbt`. | audited: same |
| nested components route through ${field,seqItem} with a pushed view (×2) | ported | `nested components route through field with a pushed view`, `… seqItem …` | audited: same |
| top-level ${renderEach,renderIt,deep renderIt} routes every item after keyed reorder (×3) | ported | `top-level renderEach …`, `top-level renderIt …`, `top-level deep renderIt …` | audited: same |
| renderIt stops event lookup at its view | ported | same name | audited: same |
| a child-scope registration after startup adds only its event listeners | ported | same name, adapted: there is no registration. The host's `listen` is called for an event name the first time a rendered component handles it. | audited: same, adapted: listeners are added at first render, not at registration (`click`, then only `dblclick`; the dblclick dispatches) |
| targetValue reads the element with the handler, not the child that was clicked | ported | same name | audited: same |

## schema.test.js → `jsport_core_schema_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| make fills defaults and rejects invalid values | by types | State is a struct: every field has a type, and defaults come from `derive(Default)` or a constructor. | — |
| array and object defaults are not shared between instances | by types | State is immutable (`Vec`, `{ ..s, f: v }`), so a shared default can't leak a mutation. | — |
| instances expose methods and their spec | by types | Methods are ordinary methods on the state type, and there is no untyped "is this a component" question. | — |
| produce keeps prototype and spec | by types | `{ ..s, f: v }` returns the same struct type, and states are immutable values. | — |
| view becomes main next to named views | ported | same name (`view_names`, and rendering each view) | audited: same |
| option fields accept null, and missing values take the default | by types | An optional field is `T?`. Its default is the struct's `Default` or constructor. | — |
| types have zero defaults and default() returns a changed copy | by types | `derive(Default)` gives zero values, and there are no type objects to copy. | — |
| getters in methods read the instance | by types | Getters are ordinary methods. | — |
| constraints narrow what a type accepts and bounds pull the default in | by types | Constraints are newtypes or enums where a type can say it. Otherwise they are invariants, which the invariant rows port. | — |
| enum, record and oneOf check members, shape and alternatives | by types | `enum`, `struct` and enums with payloads | — |
| index fields are keys of a sibling collection | divergent | There is no `t.index`: that `selected` is a key of `items` is an invariant. Ported in that form: `same name` reports `invariant 'selected is a key of items'`. | — |
| broken invariants are reported on the component | ported | same name. An invariant is `(S) -> Bool` and can't raise, so the JS throwing invariant is one that returns false. | audited: same (none when valid; both invariants at `.r`, in order. JS's throwing invariant is a false-returning one) |

## shape.test.js → `jsport_core_shape_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| a DomNode splits its attrs into a shape once: static, dynamic, key and namespace | ported | same name. `data-h` is a dynamic slot, because its value names the instance; JS's `data-eid` is static. | audited: strengthened (the rendered vnode's shape is now checked to be the component's lowered shape itself, as JS's `vnode.shape === plan.shape`, and stays that one after a re-render) |
| value, checked, is and dangerouslySetInnerHTML stay dynamic even when constant | ported | same name (including `Shape::new` refusing a static `value`) | audited: strengthened (`dangerouslySetInnerHTML` is now a constant attr, like JS, instead of a binding) |
| namespace must be a constant, and svg and math are detected once in the shape | ported | same name. `ns(...)` takes a String, so the "must be a constant" half holds by types. | audited: same (also math) |
| re-rendering a changed dynamic attr writes only that attr | ported | same name (memdom `take_mutations`) | audited: same |
| different templates with the same tag replace the element; the same one morphs | ported | same name | audited: same |
| a changed key remounts the element | ported | same name | audited: same |
| a constant select value is applied after its options are created | ported | same name | audited: same |
| tutuca normalizes child values: null, iterables, nested arrays and primitives | by types | Children are `ViewAt` values and `show` returns a String, so there are no raw child values to normalize. The splicing of nested fragments is ported in view-semantics. | — |

## view-semantics.test.js → `jsport_core_view_semantics_wbtest.mbt`

| JS test | Status | MoonBit test (file) or reason | Assertions |
|---|---|---|---|
| literal hello/42/false/null/undefined works in every expression body (×5) | ported | `literal hello, 42, false, null and undefined work in every expression body` (plain, both `if_` branches, `push_view`) | audited: same (null and undefined are both `empty()`) |
| literal condition uses JS truthiness and only evaluates the selected branch | ported | same name: only the selected branch's closure runs. Truthiness holds by types, because a condition is a `Bool`. | audited: same for "selected branch only, once". Truthiness holds by types. |
| attributes and children read fields, and $if selects values | ported | same name | audited: same |
| re-rendering patches the existing DOM | ported | same name | audited: same |
| components are wrapped in meta comments | ported | same name. The opening comment also carries `n` (name) and `p` (path). | audited: same |
| a component without a main view is rejected | by types | `component` requires `view~`. | — |
| view names don't resolve to inherited properties | ported | same name (`view_names`, and starting in `"toString"` renders main) | audited: same |
| arrays of children splice into their parent, nested ones too | ported | same name (nested `frag`) | audited: same |
