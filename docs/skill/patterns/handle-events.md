# Handle events

**Problem:** respond to a DOM event and update state.

```html
<button @on.click="inc">+</button>
<button @on.click="dec">-</button>        <!-- bare name = receive handler -->

<!-- pass args by name; ctx is auto-appended last -->
<input @on.input="setStr value" />
<input @on.input="setN valueAsInt" />
<button @on.click="addItem JsonSelector">+</button>

<!-- guards: keydown +send (Enter) / +cancel (Esc), and +ctrl/+cmd/+alt -->
<input @on.keydown+send="submit value" @on.keydown+cancel="reset" />

<!-- effects on any event: +prevent, +stop (applied only if the guards passed) -->
<form @on.submit+prevent="save">…</form>

<!-- custom elements: any CustomEvent reaches @on.<name>, detail is `value` -->
<emoji-picker @on.emoji-click="onPick value"></emoji-picker>
```

Event handlers are entries in `receive`: Tutuca passes an Immer draft first,
the written arguments next, and `ctx` last. Returning nothing commits draft
changes; returning another component swaps the current component. The first
slot in `@on.*` is always a bare receive name; `$method` is rejected. Later slots are built-in arg
names — `value`, `valueAsInt`/`valueAsFloat`, `event`, `key`, `isAlt`,
`isShift`, `isCtrl`/`isCmd`, `dragInfo`, … `value` resolves to
`event.target.value` (or `.checked` for a checkbox, or `event.detail` for a
`CustomEvent`). Bind events declaratively with `@on.` rather than reaching for
the node and `addEventListener` — an outside listener bypasses the transactor.

Pass the most granular arg the handler needs — `value`/`valueAsInt`/`key`, not
the raw `event` — so tests call it with plain literals; reach for `event` only
when nothing narrower fits (e.g. a file input reading `event.target.files`).
Why this keeps tests simple: [testing.md](../testing.md) *Designing handlers so
tests stay simple*.
