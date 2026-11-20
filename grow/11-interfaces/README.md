# 11. Interfaces

**New words:** `pure`, `queries`, `apply`, `query`, `ContractError`, `iface`,
`implements`, `interfaceGaps`.

So far a component reaches into another by reading its fields. This step gives
a component a public side, so another can use it without knowing its state:

- a **pure** message only steps its instance, so it can be applied to an
  instance directly: `apply(card, "setDone", true)` is `act` with the contract
  of step 9 enforced, and gives the next card;
- a **query** reads an instance and changes nothing: `query(card, "done")`;
- an **interface** names a set of messages and queries with their types, and
  a class says which ones it `implements`. The scope checks that when the class
  is registered.

A call that breaks the contract throws a `ContractError` that says what it
broke: `unknown`, `not-pure`, `args`, `arg:0`, `pre`, `post`, `returns`,
`invariant:<name>`.

Inside a handler, `apply` on a child writes on the draft the handler is
writing on, so one step can step several instances.

This step has no model yet: the model's handlers do not call each other. It is
the place to add one.

## Session

1. `class.js`: `pure` on `Handler`; `Query` and the `queries` option, which
   also go on the prototype so `this.label` works; `implements`.
2. `src/component/contract.js`: `ContractError`, `apply`, `query`.
3. `src/component/interface.js`: `Interface`, `iface`, `interfaceProblems`.
4. `scope.js`: `registerInterfaces`, `lookupInterface`, and `check` in
   `register`.
5. `test/contract.test.js`.

## Runs at the end

    raco test grow/11-interfaces/spec/
    node --test "grow/11-interfaces/test/*.test.js"
