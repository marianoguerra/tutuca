#lang racket
;; Typesets the tower into tree.pdf, laid out like semantics.pdf:
;;   racket spec/tree/render.rkt
;; Chapter 1 is the core, every metafunction in full; each later chapter shows
;; its tier's grammar and only the clauses the tier adds (they come first in
;; each metafunction, so metafunction-cases picks them).
(require redex/pict pict racket/runtime-path "../layout.rkt"
         (prefix-in m0: "core.rkt") (prefix-in m1: "fields.rkt") (prefix-in m2: "grow.rkt")
         (prefix-in m3: "clear.rkt") (prefix-in m4: "replace.rkt") (prefix-in m5: "reorder.rkt")
         (prefix-in m6: "swap.rkt") (prefix-in m7: "fsm.rkt"))

(define-runtime-path out "tree.pdf")

(define escape-names
  (hash 'eq "eq" 'δ "δ" 'attempt "try" 'add1 "succ" 'sub1 "pred" 'length "length"))

;; Only the clauses a tier added to a metafunction.
(define (unprefixed sym) (string->symbol (cadr (regexp-match #rx"^[^:]*:(.*)$" (symbol->string sym)))))
(define-syntax-rule (own own-clauses name)
  (let ([n (hash-ref own-clauses (unprefixed 'name))])
    (parameterize ([metafunction-cases (range n)]) (mf name))))

;; ---- the results table ------------------------------------------------------
(define (cell str [style 'roman]) (text str style 9))
(define (results-table header rows)
  (table (length header)
         (append (map (λ (h) (cell h '(bold . roman))) header)
                 (for*/list ([row rows] [c row]) (cell c)))
         lt-superimpose lt-superimpose 10 5))

(define doc-title "Trees of Components and Asynchronous Messages")
(define doc-subtitle "A tower of PLT Redex models: how a message's route survives a changing tree")

(define abstract
  (list
   (string-append
    "A tree of components, owned by a host, changes in discrete transactions. Components "
    "send messages to each other: notifications and requests bubble up through their "
    "ancestors to the host, send-at goes down a path, and replies go back to whoever sent "
    "the message being handled. Responses to requests arrive asynchronously, in any order. "
    "The question this model answers is what happens to a message's route when the tree "
    "changes between the moment the message is sent and the moment it, or its response, "
    "arrives.")
   (string-append
    "The model is a tower of eight tiers. Each extends the previous one's language with one "
    "feature: fields, collections that only grow, clearing, replacing, reordering, a "
    "component swapping itself, and control states. Each tier is checked against four "
    "routing policies: by path, by path with an identity check, by identity, and anchored "
    "to the sender. A bounded model checker explores every interleaving of each scenario "
    "and finds, as the shortest trace, the counterexample to each property a policy loses.")
   (string-append
    "Conventions. Read as TLA+, a configuration is the state and the reduction relation is "
    "Next. Handlers are deterministic, and the messages they emit run in FIFO order, so the "
    "only nondeterminism is when events and responses arrive. A metafunction undefined on its "
    "input stands for a thrown exception, which fails the transaction it happens in (try). "
    "Chapter 1 gives every metafunction; each later chapter gives only the clauses its tier "
    "adds, which come before the inherited ones. Shaded fragments are Racket code. The "
    "rules are executable: raco test spec/tree/ checks them.")))

(define (content)
  (list
   (chap
    "The core (M0)"
    (string-append
     "A host and one root component. Every message is one envelope, (msg mode m from to), "
     "carrying its sender's address, so every handler can reply. Nonterminals later tiers "
     "fill in are ⊥ here: there are no children yet, and the only path is the root's, ().")
    (sect
     "Programs"
     (string-append
      "A program is its kinds, a host and its options: a routing policy and a granularity. "
      "A kind declares its locals, its child slots and its handlers. A handler's actions "
      "update locals, log, and put out messages: a notification or a request that bubbles, "
      "a send-at down a path relative to the receiver, or a reply to the sender. A hop of a "
      "bubble passes, stops it or answers it.")
     (figure "Programs: kinds, handlers and the host."
             (lang m0:Core #:nts '(e act handler kdef host-def event script policy gran P))))
    (sect
     "Configurations"
     (string-append
      "An instance has a kind, an identity, locals and slots. An address is the host, or a "
      "path with the identity found there when it was recorded; a send-at's also keeps its "
      "sender and its relative path. The world is the tree, the FIFO queue, the responses "
      "in flight, the events still to come, the next fresh id and the observations.")
     (figure "Instances, addresses, messages and the world."
             (lang m0:Core #:nts '(c π pp addr urg r mode ιh dest message self here env outcome out σ cfg))))
    (sect
     "The reduction relation"
     (string-append
      "Four rules, the same in every tier. env and env-choice run the next scripted event "
      "at once, ahead of the queue. respond lets any response in flight arrive: an urgent "
      "one runs at once, a normal one is queued. run runs the message at the head of the "
      "queue. Only env, env-choice and respond branch.")
     (figure "tree->: arrivals are the only nondeterminism."
             (fit (λ () (render-reduction-relation m0:tree-> #:style 'vertical)))))
    (sect
     "Expressions and actions"
     (string-append
      "eval reads a value, an argument or a local; δ is integer arithmetic and comparison, "
      "comparisons giving 1 or 0. acts runs a handler's actions in order on the receiver's "
      "draft and collects what they put out; arguments are evaluated when the action runs.")
     (figure "Expressions."
             (part "eval" (mf m0:eval))
             (part "set-local" (mf m0:set-local))
             (part "emit" (mf m0:emit)))
     (figure "Actions, in order, on the receiver's draft."
             (part "acts" (mf m0:acts))))
    (sect
     "Instances and trees"
     (string-append
      "make builds a fresh instance, its identity the next fresh number. The tree is walked "
      "by child-at and rebuilt by put-child, which later tiers define for each kind of step; "
      "locate finds an identity's path. concretize turns a written step into a concrete "
      "one, against the instance it starts from.")
     (figure "Making instances."
             (part "kind-def" (mf m0:kind-def))
             (part "make" (mf m0:make))
             (part "override" (mf m0:override))
             (part "make-slots, finish" (vl-append 4 (mf m0:make-slots) (mf m0:finish))))
     (figure "Paths over trees."
             (part "node-at" (mf m0:node-at))
             (part "put-at" (mf m0:put-at))
             (part "children, slot-children" (vl-append 4 (mf m0:children) (mf m0:slot-children)))
             (part "locate" (mf m0:locate))
             (part "locate-in" (mf m0:locate-in))
             (part "ancestors" (mf m0:ancestors))
             (part "concretize-path" (mf m0:concretize-path))
             (part "child-at, eval-step, concretize: none here" (vl-append 4 (mf m0:child-at) (mf m0:eval-step) (mf m0:concretize)))))
    (sect
     "Routing"
     (string-append
      "resolve finds the receiver of an address under the program's policy. by-path takes "
      "whatever is at the path; by-path-checked takes it only if it has the recorded "
      "identity, and says stale otherwise; by-identity finds the identity wherever it is. "
      "An address that reaches nothing is orphaned. The host is always found.")
     (figure "Resolving an address under a policy."
             (part "resolve" (mf m0:resolve))
             (part "resolve-in" (mf m0:resolve-in))
             (part "id-of" (mf m0:id-of))))
    (sect
     "Handlers"
     (string-append
      "A message's key is its mode and name; a response's is its result's kind. A "
      "component's handler for it is in its kind, the host's in the host. A response's "
      "handler gets the result's value as its argument.")
     (figure "Finding a handler."
             (part "find-handler" (mf m0:find-handler))
             (part "handler-for" (mf m0:handler-for))
             (part "handler-of" (mf m0:handler-of))
             (part "key-of" (mf m0:key-of))
             (part "args-of" (mf m0:args-of))))
    (sect
     "Transactions"
     (string-append
      "transact runs one handler: its actions on the receiver's draft, the commit of the new "
      "draft at the receiver's place, then dispatch, which turns what the actions put out "
      "into messages from the receiver's address. A send-at's target is resolved against "
      "the committed tree, so it can be an instance the same transaction made; one that "
      "doesn't resolve fails the transaction. run-txn runs a transaction under try: a failed "
      "one leaves the world as it was, and is observed.")
     (figure "One transaction."
             (part "transact" (mf m0:transact))
             (part "commit" (mf m0:commit))
             (part "addr-at" (mf m0:addr-at))
             (part "outcome-of" (mf m0:outcome-of)))
     (figure "From what actions put out to messages."
             (part "dispatch" (mf m0:dispatch))
             (part "target" (mf m0:target)))
     (figure "Committing to the world."
             (part "run-txn" (mf m0:run-txn))
             (part "try-commit" (mf m0:try-commit))
             (part "observe, enqueue, fly, tree-of"
                   (vl-append 4 (mf m0:observe) (mf m0:enqueue) (mf m0:fly) (mf m0:tree-of)))))
    (sect
     "Turns"
     (string-append
      "A directed message is one transaction at its resolved receiver, or ignored if the "
      "receiver has no handler for it. A bubbling message is one turn: its sender is "
      "resolved, the ancestors it should visit are fixed, and every hop runs, one "
      "transaction each, until it is stopped, answered, or reaches the host. Under per-hop, "
      "the rest of the bubble is queued after each hop instead. An env event's route is "
      "resolved against the tree as it is when it happens.")
     (figure "Directed messages."
             (part "directed" (mf m0:directed))
             (part "handle" (mf m0:handle)))
     (figure "Starting a bubble: its sender, and the ancestors it will visit."
             (part "bubble" (mf m0:bubble))
             (part "visit" (mf m0:visit)))
     (figure "Hops: the next is the parent of the last, until the host."
             (part "hops" (mf m0:hops))
             (part "continue" (mf m0:continue)))
     (figure "How a bubble ends."
             (part "end-bubble" (mf m0:end-bubble)))
     (figure "Events, arrivals and the head of the queue."
             (part "env-turn" (mf m0:env-turn))
             (part "arrive" (mf m0:arrive))
             (part "run" (mf m0:run)))))

   (chap
    "Fields (M1)"
    (string-append
     "A component holds children in named fields, fixed for its life. Paths get their first "
     "step, and bubbles pass through ancestors. Since fields never change, no path can move, "
     "and every policy delivers every message where it was meant to go.")
    (sect
     "Fields"
     (string-append
      "A slot holds an instance; a kind declares it with (new k (g e) ...), an instance of k "
      "whose given locals override its state. The step (field f) reaches it.")
     (figure "Fields: the grammar the tier adds."
             (lang m1:Fields #:nts '(sval step pstep mk snew)))
     (figure "Fields: the clauses the tier adds."
             (part "slot-of, slot-set" (vl-append 4 (own m1:own-clauses m1:slot-of) (own m1:own-clauses m1:slot-set)))
             (part "child-at, put-child" (vl-append 4 (own m1:own-clauses m1:child-at) (own m1:own-clauses m1:put-child)))
             (part "slot-children" (own m1:own-clauses m1:slot-children))
             (part "concretize" (own m1:own-clauses m1:concretize))
             (part "make-slots, make-slot, make-new"
                   (vl-append 4 (own m1:own-clauses m1:make-slots) (own m1:own-clauses m1:make-slot)
                              (own m1:own-clauses m1:make-new)))))
    (sect
     "Location independence"
     (string-append
      "A component never sees its own path, and bubbling to its parent means the same "
      "whether the parent is the host or another component. Checked (P5): a component at the "
      "root, and the same component under a wrapper that handles nothing, give the host the "
      "same messages. Checked: every property holds under every policy, turn or per-hop.")
     (figure "What holds in M1."
             (note "P1 identity, P2 exactly once, P3 soundness and P7 hops hold under every policy and granularity;"
                   "the policies agree; P5 holds."))))

   (chap
    "Collections that only grow (M2)"
    (string-append
     "A list can be appended to and a map given a new key, nothing else. Appending never "
     "moves an item that exists, so every recorded path still reaches what it reached.")
    (sect
     "Lists and maps"
     (string-append
      "Paths get (index f i) and (key f κ), and written paths (sel f g): the item of list f "
      "at the index in the parent's local g, as this.tabs[this.selected]. A sel is resolved "
      "when its path is recorded: an env event's when it happens, a send-at's against the "
      "committed tree, the sender's own changes included.")
     (figure "Lists and maps: the grammar the tier adds."
             (lang m2:Grow #:nts '(sval item step pstep snew e act)))
     (figure "Reaching items."
             (part "item-at, item-set" (vl-append 4 (own m2:own-clauses m2:item-at) (own m2:own-clauses m2:item-set)))
             (part "child-at, put-child" (vl-append 4 (own m2:own-clauses m2:child-at) (own m2:own-clauses m2:put-child)))
             (part "slot-children, indexed, keyed"
                   (vl-append 4 (own m2:own-clauses m2:slot-children) (own m2:own-clauses m2:indexed)
                              (own m2:own-clauses m2:keyed)))
             (part "eval-step, concretize" (vl-append 4 (own m2:own-clauses m2:eval-step) (own m2:own-clauses m2:concretize))))
     (figure "Growing."
             (part "acts" (own m2:own-clauses m2:acts))
             (part "eval, make-slot" (vl-append 4 (own m2:own-clauses m2:eval) (own m2:own-clauses m2:make-slot)))
             (part "nth, set-nth, has-key"
                   (vl-append 4 (own m2:own-clauses m2:nth) (own m2:own-clauses m2:set-nth) (own m2:own-clauses m2:has-key))))))

   (chap
    "Clearing (M3)"
    (string-append
     "An item can be cleared, leaving a tombstone whose place is never reused. A recorded "
     "address can now reach nothing: a message to a cleared item is orphaned under every "
     "policy. Within a turn a bubble's hops can't be cleared under it; hop by hop they can, "
     "and the rest of the bubble is lost.")
    (sect
     "Tombstones"
     (string-append
      "clear leaves cleared in an item's place. No tier before this one reads cleared: an "
      "item that isn't an instance is not a child.")
     (figure "Clearing."
             (lang m3:Clear #:nts '(item act))
             (part "slot-step" (own m3:own-clauses m3:slot-step))
             (part "acts" (own m3:own-clauses m3:acts)))))

   (chap
    "Replacing (M4)"
    (string-append
     "An item's place, cleared or not, or a field, can get a new instance. A path can now "
     "reach an instance other than the one it was recorded for, and the policies part ways: "
     "by-path delivers to the replacement, by-path-checked says stale, by-identity says "
     "orphaned.")
    (sect
     "New instances in old places"
     "put gives an item's place a new instance; put-field does the same for a field."
     (figure "Replacing."
             (lang m4:Replace #:nts '(act))
             (part "acts" (own m4:own-clauses m4:acts))
             (part "exists" (own m4:own-clauses m4:exists)))))

   (chap
    "Reordering (M5)"
    (string-append
     "A list can be prepended to or inserted into, shifting the items after the new one. "
     "An instance now outlives its path. by-identity finds it where it moved; anchored, the "
     "tier's new policy, finds a send-at's sender by identity and applies the relative path "
     "again, so it reaches whatever is at items[i] now.")
    (sect
     "Shifting items"
     "insert puts a new instance before index i; prepend is insert at 0."
     (figure "Reordering and the anchored policy."
             (lang m5:Reorder #:nts '(policy act))
             (part "acts" (own m5:own-clauses m5:acts))
             (part "insert-at" (own m5:own-clauses m5:insert-at))
             (part "resolve" (own m5:own-clauses m5:resolve)))))

   (chap
    "Swapping (M6)"
    (string-append
     "A handler can replace its own receiver with a new instance, of the same kind or "
     "another. The instance that sent a message can be gone from a place that never "
     "changed: by-path delivers its response to the new instance, which may have no handler "
     "for it.")
    (sect
     "A component replacing itself"
     (string-append
      "swap replaces the receiver's draft. What the handler set before it is dropped; what "
      "it does after applies to the new instance, which the commit writes in the old one's "
      "place. Effects are still sent from the old instance's address.")
     (figure "Swapping."
             (lang m6:Swap #:nts '(act))
             (part "acts" (own m6:own-clauses m6:acts)))))

   (chap
    "State machines (M7)"
    (string-append
     "A kind can declare control states, with handlers per state. A request sent in one "
     "state can be answered in another, where nothing handles the response: it reaches the "
     "right instance, and is ignored. Routing can't help; a static check on the protocol can.")
    (sect
     "Control states"
     (string-append
      "An instance starts in its kind's first state, and goto moves it. The current state's "
      "handlers come before the kind's common ones. Checked: well-formed? (every state "
      "reachable from the one a request leaves its sender in, until the response is taken, "
      "handles every response the kind handles anywhere) makes P6 hold in every "
      "interleaving.")
     (figure "Control states."
             (lang m7:Fsm #:nts '(kdef c act))
             (part "finish" (own m7:own-clauses m7:finish))
             (part "handler-for" (own m7:own-clauses m7:handler-for))
             (part "acts" (own m7:own-clauses m7:acts)))))

   (chap
    "What holds where"
    (string-append
     "The properties are invariants of every reachable configuration of bounded scenarios, "
     "checked by exploring all of them breadth first; the first violation found has a "
     "shortest trace. Where a property fails, the tests require the counterexample to be "
     "found.")
    (sect
     "Properties"
     (string-append
      "P1: no two instances share an identity. P2: a request is answered at most once, and "
      "once nothing is left to happen has exactly one outcome. P3: every delivered message "
      "reaches the identity its address recorded. P4: while nothing moves, the policies give "
      "the same outcomes. P5: location independence. P6: every delivered response finds a "
      "handler in its receiver's current state. P7: every hop of a bubble visits the ancestor "
      "the sender had when the bubble started, and no bubble is lost.")
     (figure "Each tier against each policy, under turn granularity unless said otherwise."
             (results-table
              '("Tier" "by-path" "by-path-checked" "by-identity" "anchored")
              '(("M0–M2" "all hold" "all hold" "all hold" "")
                ("M3" "all hold; per-hop breaks P7" "same" "same" "")
                ("M4" "P3 breaks" "holds: stale" "holds: orphaned" "")
                ("M5" "P3 breaks" "holds, refuses movers" "holds, delivers" "send-at: new items[i]")
                ("M6 same kind" "P3 breaks" "holds: stale" "holds: orphaned" "as by-identity")
                ("M6 other kind" "P3, P6 break" "holds" "holds" "as by-identity")
                ("M7" "P6 breaks" "P6 breaks" "P6 breaks" "P6 breaks")))
             (note "M7: P6 holds, under every policy, for kinds that are well-formed?."))))))

(write-document out #:title doc-title #:subtitle doc-subtitle #:abstract abstract #:content content
                #:escape-names escape-names)
