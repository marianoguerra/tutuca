# Trees of components and asynchronous messages

A standalone PLT Redex model, separate from the rest of `spec/`. It asks one question: **what
happens to a message's route when the tree changes between the moment the message is sent
and the moment it, or its response, arrives?**

The model is a tower of tiers, M0 to M7. Each tier extends the one before it with one
feature. Each tier says which properties still hold for each routing policy. When a property
breaks, the tests require Redex to find the counterexample.

```sh
raco test spec/tree/          # every tier's scenarios, properties and expected counterexamples
raco test spec/tree/swap.rkt
racket spec/tree/render.rkt   # typesets the tower into spec/tree/tree.pdf
```

In `tree.pdf`, Chapter 1 gives the core: its grammar, the reduction relation, and every
metafunction of the engine. Each later chapter gives its tier's grammar and only the clauses
the tier adds.

It requires only `redex/reduction-semantics`, not the other layers of `spec/`.

## Reading it as TLA+

- A **configuration** is the state.
- The reduction relation `tree->` is `Next`.
- Handlers are deterministic.
- The messages handlers emit run in FIFO order from one queue. The only nondeterminism is
  *when* things arrive from outside:
  - environment events, run at once, ahead of the queue
  - responses, in any order among themselves: a normal one is appended to the queue, an
    urgent one runs at once
- From any configuration, at most one `run` step is enabled. Every branch is an arrival.

`check.rkt` is the TLC. It explores every reachable configuration of a bounded scenario,
breadth first, checks invariants on each, and returns the shortest trace to a violation.

## The model

### Entities

| Concept | Meaning |
|---|---|
| **kind** `k` | which handlers an instance has: `(kind k (state (g e) ...) sdecls (handler ...))` |
| **identity** `ι` | an opaque fresh number. An update keeps it; only a new instance gets a new one |
| **instance** | `(comp k ι ((g v) ...) slots)`: kind, identity, locals and child slots |
| **host** | the root's parent, with handlers of its own and no state. It is the ancestor of last resort |
| **path step** | `(field f)`, `(index f i)`, `(key f κ)`. A written path can also hold `(sel f g)`: list `f` at the index in local `g` |
| **address** | `host`, `(at π ι)`, or, for a `send-at`, `(at π ι ι-sender rel)` |

A component never sees its own path. A notification it sends bubbles to its parent, whether
the parent is the host or another component. P5 checks this.

### One envelope

```
(msg mode m from to)
mode ::= send | notify | (request ρ urg) | (response ρ r urg)
r    ::= (ok v) | (error v) | (unhandled)
to   ::= an address (directed) | (hop last) | (hop last (expected ...))   (bubbling)
```

Every message carries its sender's address, so **every handler can reply**: `(reply n e ...)`
sends to the `from` of the message being handled. The receiver can reply in turn, any number
of times.

A bubbling message keeps its original `from` at every hop. So a reply from any hop reaches
the sender, not the hop below it.

### Handlers

```
(on hkey (x ...) (act ...))
hkey ::= (send n) | (notify n) | (request n) | (ok n) | (error n) | (unhandled n)
```

| Action | Tier | Meaning |
|---|---|---|
| `(set g e)`, `(log e)`, `(if e (act ...) (act ...))` | M0 | update a local, observe a value, branch |
| `(notify n e ...)` | M0 | bubble a notification from here |
| `(request n e ...)`, `(request/urgent n e ...)` | M0 | bubble a request; its response, when it arrives, is queued or runs at once |
| `(send-at pp n e ...)` | M0 | a directed message down the path `pp`, relative to here. `()` is self |
| `(reply n e ...)` | M0 | a directed message to the sender of the message being handled |
| `pass`, `stop`, `(answer ok e)`, `(answer error e)` | M0 | what a hop does with a bubble. `pass` is the default |
| `(append f mk)`, `(add-key f e mk)` | M2 | grow a list or a map. `mk` is `(new k (g e) ...)` |
| `(clear f e)` | M3 | clear an item, leaving a tombstone |
| `(put f e mk)`, `(put-field f mk)` | M4 | give an item's place, or a field, a new instance |
| `(prepend f mk)`, `(insert f e mk)` | M5 | shift the items after the new one |
| `(swap mk)` | M6 | replace the receiver itself |
| `(goto q)` | M7 | move to another control state |

**Effects are queued when the transaction commits,** in order, and are sent from the
handler's address.

**A `send-at` resolves against the committed tree, not the one the handler read.** So a
handler can append an item and `init` it in the same transaction. Each `sel` resolves to an
`index` there. A target that doesn't resolve fails the transaction.

A *pinned* `send-at` would require the target's identity as of handler time. It is a
possible opt-in, not modeled.

### Scheduling

- A **transaction** is one handler and one commit. When it fails, only its observation
  survives.
- A **turn** delivers one message:
  - a **directed turn** is one transaction
  - a **bubble turn** runs every hop, one transaction each, until the message is stopped or
    answered, or until the host handles it
- **Effects wait until the turn ends.** Nothing arrives between hops.
- **At the host:**
  - a notification nobody stopped is observed as `(unhandled n)`
  - a request nobody answered gets `(response ρ (unhandled))`

The rules of `tree->`, the same in every tier:

| Rule | Kind | What it does |
|---|---|---|
| `env`, `env-choice` | nondeterministic | run the next scripted event now. Its route is resolved against the tree as it is, and `(one-of ev ...)` picks any one |
| `respond` | nondeterministic | any response in `inflight` arrives: urgent ones run now, normal ones are appended |
| `run` | deterministic | run the turn at the head of the queue |

**Granularity** is a flag, `turn` (the default) or `per-hop`. Under `per-hop`, the rest of a
bubble goes to the back of the queue after each hop, which is what tutuca's per-hop tasks
do.

Under `turn`, a bubble's hops can't move during the turn:

- a hop changes only itself and what is below it
- a hop's ancestors are not below it

So every hop is a prefix of the sender's path, and the policy is needed only once, to find
the sender (P7).

### Routing policies

| Policy | Resolves `(at π ι ...)` to |
|---|---|
| `by-path` | whatever is at `π` now (tutuca's frozen routes) |
| `by-path-checked` | what is at `π`, if its identity is `ι`. Otherwise `stale` |
| `by-identity` | wherever `ι` is now. `orphaned` if it is gone |
| `anchored` (M5) | the sender found by identity, then `rel` applied again from where it is now. Without `rel`, it resolves as `by-identity` |

### Observations

Properties are read off these observations:

| Observation | Meaning |
|---|---|
| `(deliver mode n ι-intended ι-actual)` | a directed message reached `ι-actual` |
| `(ignored mode n ι)` | it reached `ι`, which has no handler for it |
| `(orphaned mode n ι)` | its address reached nothing |
| `(stale mode n ι ι-found)` | `by-path-checked` refused it |
| `(hop mode n ι-actual ι-expected)` | one hop of a bubble |
| `(lost mode n ι)` | a started bubble couldn't find its last hop (only under `per-hop`) |
| `(requested ρ)`, `(answered ρ r)` | a request was sent; it was answered |
| `(unhandled n)` | a notification reached the host and nobody stopped it |
| `(failed n reason)` | a transaction failed |
| `(no-target n)` | an env event's path reached nothing |
| `(log v)` | a value the handler logged |

### Properties (`check.rkt`)

| Property | Holds when |
|---|---|
| **P1** identity | no two instances in the tree share an identity |
| **P2** exactly once | a request is answered at most once, and has exactly one outcome once nothing is left to happen: delivered, orphaned, stale or lost |
| **P3** soundness | every delivered message reaches the identity its address recorded |
| **P5** location independence | a component at the root, and the same component under a wrapper that passes everything, give the host the same messages (tested in M1) |
| **P6** protocol | every delivered response finds a handler in its receiver's current state |
| **P7** hops | every hop visits the ancestor the sender had when the bubble started, and no bubble is lost |

**P4**, policy agreement, is a check too: while nothing moves, every policy gives the same
final observations.

## The tower

Each tier is one file. A tier has two parts:

- its language: `define-extended-language` over the previous tier
- its clauses: `define-tier`, which adds clauses to the engine's metafunctions (and may add
  metafunctions of its own)

The engine is a set of Redex metafunctions, defined once in `core.rkt` over `Core`. Redex's
`define-metafunction/extension` can't grow it: an extension's inherited clauses reach the
extended metafunction only when they call themselves, and the engine's metafunctions call
each other (`acts` calls `eval`, `make` calls `make-slots`, ...).

So `define-tier` (in `engine.rkt`) instantiates every metafunction again, over the tier's
language and in the tier's module:

- **Clause order:** the tier's own clauses come first, then the inherited ones.
- **Calls:** every call, in every clause, reaches the tier's version.
- **Relation:** `define-tier` also defines the tier's relation, the same four rules over the
  new language.
- **Domain:** the relation's domain is the tier's `cfg`. So it rejects a program that uses a
  later tier's form, and the tests check this.

Two pieces of Racket are left:

- **`try`:** a transaction runs under `try`, which turns a metafunction undefined on its
  input (the model's thrown exception) into a failed transaction.
- **`well-formed?`:** M7's protocol check is a static check on kinds, not part of the
  reduction.

| Tier | File | Adds |
|---|---|---|
| | `engine.rkt` | `define-tier`, and reading configurations from Racket |
| M0 | `core.rkt`, `core-test.rkt` | the envelope, host and root, every effect, the queue and arrivals, the policies |
| M1 | `fields.rkt` | `(field f)`, bubbling through ancestors, P5 |
| M2 | `grow.rkt` | lists and maps that only grow, `index`, `key` and `sel` |
| M3 | `clear.rkt` | clearing an item (a tombstone, never refilled) |
| M4 | `replace.rkt` | a new instance in an item's place or a field |
| M5 | `reorder.rkt` | prepend and insert, and the `anchored` policy |
| M6 | `swap.rkt` | a component replacing itself, with the same kind or another |
| M7 | `fsm.rkt` | control states, per-state handlers, and the protocol check `well-formed?` |

### What holds where

The default granularity, `turn`, unless the cell says otherwise.

| Tier | `by-path` | `by-path-checked` | `by-identity` | `anchored` |
|---|---|---|---|---|
| M0–M2 | all hold | all hold | all hold | |
| M3 | all hold; a message to a cleared item is orphaned. Under `per-hop`, **P7 breaks**: an ancestor is cleared between hops and the bubble is lost | same | same | |
| M4 | **P3 breaks**: the replacement gets the response, a reply or a `send-at`. Urgency doesn't help | holds: `stale` | holds: `orphaned` | |
| M5 | **P3 breaks**: whatever moved into the index gets it | holds, but refuses messages to receivers that still exist | holds: **always delivers** | a `send-at` reaches the new `items[i]`. P3 breaks, by design |
| M6a (same kind) | **P3 breaks**: the new instance gets it | holds: `stale` | holds: `orphaned` | as `by-identity` |
| M6b (another kind) | **P3 and P6 break**: the new kind ignores it | holds | holds | as `by-identity` |
| M7 | **P6 breaks under every policy**, for a request answered after its sender moved to a state that doesn't handle the response. It holds for every kind that is `well-formed?` | same | same | same |

### What tutuca does

Tutuca's JS runtime, tutuca-wax and the main spec (`../system/host.rkt`) now take these
choices:

- **`by-path-checked`:** a route is a path plus the identity it reached. A message whose path
  another instance took is dropped and reported `stale`.
- **`turn`:** a notification's next hop goes to the front of the queue, so its hops run back to
  back.
- **Explicit pass:** an ancestor without a handler passes a notification on silently, and one
  nobody handled is reported `unhandled` once, at the root.

They were `by-path` with `per-hop` before, and the main spec's interleaving scenarios showed
the M4/M5 misdelivery there. A swap (a handler returning a new instance) gives a new identity,
as in M6.

### Findings

- **Moving paths.** Paths only move from M4 on:
  - Until then, the policies can't be told apart.
  - From there, only identity-based routing is sound.
  - `by-identity` is the only policy that delivers to a receiver that still exists (M5).
- **Two meanings of `send-at`.** `anchored` and `by-identity` differ:
  - `anchored` means "my child at `items[0]`"
  - `by-identity` means "that instance"
- **Hop atomicity.** It matters from M3 on. A turn can't lose a bubble; `per-hop` can.
- **Swaps.** A swap is a new identity. Open question: should a swap forward the messages in
  flight to the old instance? That needs a policy that maps identities through swaps.
- **State.** Routing can't fix a protocol: a response can reach the right instance in the
  wrong state. `well-formed?` is the static check that rules that out.

## Printing a counterexample

```racket
(require "spec/tree/core.rkt" "spec/tree/replace.rkt" "spec/tree/check.rkt")
(show-trace (counterexample replace-> some-config p3-sound))
```

## The explorer

`demos/tree-spec/` steps through the scenarios in `scenarios.rkt`, which are small programs
for M0 to M7. At each state it lists what can happen next: an event, a response arriving, or
the head of the queue running. Choosing one moves to the state it leads to.

```sh
racket spec/tree/export.rkt   # writes demos/tree-spec/scenarios/*.json
```

`export.rkt` explores each scenario with Redex and writes its whole state graph as JSON. The
components in `components/tree-spec/` show any state:

- the tree as SVG
- an arrow for each message, red when its address reaches another instance than the one it
  recorded
- the queue, the responses in flight, the script and the observations

`components/tree-spec/fixtures.js` builds states by hand, for states no scenario reaches.
