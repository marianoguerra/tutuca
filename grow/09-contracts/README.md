# 9. Contracts

**New words:** `invariants`, `args`, `pre`, `post`, `message-issues`,
`invalid-in` (`messageIssues`, `invalidIn`).

A class can say more than what its handlers do: what they are allowed to do.

- A message's **contract**: the types of its arguments, a precondition on
  `self` and the arguments, a postcondition relating `self` and `next`.
- A class's **invariants**: predicates that hold on every instance.

Nothing here changes what `act` does. These are two new functions that look at
what `act` did and list what is wrong with it: `message-issues` for one
handled message, `invalid-in` for a whole state. An empty list is a pass.

`invalid-in` skips whatever is the same as before the message. A handler
changes one instance, so only the path to it is walked.

The step ends with a property: a handler *refines* its contract when, from any
valid instance and any arguments that meet `pre`, its step meets `post` and
leaves the fields valid. The model checks it with `redex-check`, the code with
fast-check, and both catch a handler that adds twice.

## Sessions

**Spec.**

1. `class.rkt`: the `invariants` section; `contract` in `handler`;
   `contract-of`.
2. `action.rkt`: `holds?` (a predicate that throws does not hold);
   `message-issues`.
3. `invalid-in`: undeclared fields, invalid fields, then broken invariants.
4. The refinement property.

**Code.**

1. `class.js`: `Handler` (an `on` entry is a function, or `{ run, args, pre,
   post }`), and `invariants`.
2. `action.js`: `act` calls `handler.run`; `messageIssues`; `invalidIn`.
3. `test/action.test.js`.

**Seam.** `act` called `handler` in step 8 and calls `handler.run` now.

## Runs at the end

    raco test grow/09-contracts/spec/
    node --test "grow/09-contracts/test/*.test.js"
