# Handle events

**Problem:** respond to a DOM event and update state.

```html
<button @on.click="inc">+</button>
<button @on.click="dec">-</button>        <!-- bare name = receive handler -->

<!-- pass args by name; ctx is auto-appended last -->
<input @on.input="setStr e.value" />
<input @on.input="setN valueAsInt" />
<button @on.click="addItem JsonSelector">+</button>

<!-- guards: keydown +send (Enter) / +cancel (Esc), and +ctrl/+cmd/+alt -->
<input @on.keydown+send="submit e.value" @on.keydown+cancel="reset" />

<!-- effects on any event: +prevent, +stop (applied only if the guards passed) -->
<form @on.submit+prevent="save">…</form>

<!-- custom elements: any CustomEvent reaches @on.<name>, detail is `e.value` -->
<emoji-picker @on.emoji-click="onPick e.value"></emoji-picker>
```

Event handlers are entries in `receive`: Tutuca passes an Immer draft first,
the written arguments next, and `ctx` last. Returning nothing commits draft
changes; returning another component swaps the current component. The first
slot in `@on.*` is always a bare receive name; `$method` is rejected. Later slots are event-member reads — `e.value`, `e.key`, `e.altKey`,
`e.target`, and dotted paths like `e.target.dataset.slot` or `e.detail.x`
(null-safe at every link) — plus one-level computed conveniences such as
`e.valueAsInt` and `e.isCtrl` (mac-aware). A few channel args have no `e.`
form: `ctx`, `dragInfo`.
`e.value` normalizes the read: `.checked` for a checkbox, `detail` for a
`CustomEvent`, otherwise `target.value`. Bind events declaratively with `@on.`
rather than reaching for the node and `addEventListener` — an outside listener
bypasses the transactor.

Pass the most granular arg the handler needs — `e.value`/`valueAsInt`/`e.key`,
not the raw event object — so tests call it with plain literals; reach for
`e.target` only when nothing narrower fits (e.g. a file input reading
`e.target.files`).
Why this keeps tests simple: [testing.md](../testing.md) *Designing handlers so
tests stay simple*.
