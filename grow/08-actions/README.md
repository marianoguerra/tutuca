# 8. Actions

**New words:** `on`, `handler`, `step`, `cases`, `next`, `become`, `log`,
`fail`, `act`.

A class says which messages its instances handle. A handler is an action, as
in TLA+: a step from the instance before the message, `self`, to the instance
after it, `next`. `act` runs one message on one instance and gives the next
instance. Nothing else changes: the instance it was given is still there.

    (inc (by) (step (next (n) (+ (get self n) by))))

    inc(next, [by]) {
        next.n = this.n + by;
    }

In the model a handler is a term: a `step` with updates, or `cases` whose first
true guard picks the step. In the code it is a function that writes on `next`,
a draft of the instance, and `this` is `self`.

A handler can throw. Then there is no next instance: the outcome is `aborted`,
and whatever it did to the world before throwing stays done.

## Sessions

**Spec.**

1. `class.rkt`: the `on` section; `handler`, `body`, `part`, `lv`, `eff`;
   `handler-of`.
2. `spec/component/action.rkt`: `fx` and `stepped`; `handler-env`;
   `enabled-step`.
3. `run-step`: updates read `self`; `become`; effects in order, seeing `next`;
   `fail`.
4. `act`, and its tests.

**Code.**

1. `class.js`: `on` in `component()`, and `immerable` on the prototype.
2. `src/component/action.js`: `act`, with immer's `produce`.
3. `test/action.test.js`: the model's tests, with effects as pushes to an
   array.

One test of the model has no twin: there, a missing argument reads as null and
adding null throws; in JavaScript adding `undefined` gives `NaN`. Step 9's
contracts are what catches that.

## Runs at the end

    raco test grow/08-actions/spec/
    node --test "grow/08-actions/test/*.test.js"
