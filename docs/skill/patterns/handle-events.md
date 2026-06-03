# Handle events

**Problem:** respond to a DOM event and update state.

```html
<button @on.click="$inc">+</button>      <!-- $ calls a method -->
<button @on.click="dec">-</button>        <!-- bare name = input handler -->

<!-- pass args by name; ctx is auto-appended last -->
<input @on.input="$setStr value" />
<input @on.input="$setN valueAsInt" />
<button @on.click="$addItem JsonSelector">+</button>

<!-- modifiers: keydown +send (Enter) / +cancel (Esc), and +ctrl/+cmd/+alt -->
<input @on.keydown+send="$submit value" @on.keydown+cancel="$reset" />

<!-- custom elements: any CustomEvent reaches @on.<name>, detail is `value` -->
<emoji-picker @on.emoji-click="onPick value"></emoji-picker>
```

Handlers return a (new) instance of `this`. The first slot is a handler name
(`$method`, or a bare name in `input`/`alter`); later slots are built-in arg
names — `value`, `valueAsInt`/`valueAsFloat`, `event`, `key`, `isAlt`,
`isShift`, `isCtrl`/`isCmd`, `dragInfo`, … `value` resolves to
`event.target.value` (or `.checked` for a checkbox, or `event.detail` for a
`CustomEvent`). Bind events declaratively with `@on.` rather than reaching for
the node and `addEventListener` — an outside listener bypasses the transactor.
