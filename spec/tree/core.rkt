#lang racket
;; M0, the core: a host, one root component, and messages between them.
;;
;; Read as a TLA+ specification, a configuration is the state and tree-> is
;; Next. Handlers are deterministic and the messages they emit run in FIFO
;; order, so the only nondeterminism is when things arrive from outside: env
;; events (user interactions, the host) run at once, ahead of the queue, in the
;; order of the scenario's script, (one-of ev ...) choosing any one; the
;; responses in flight arrive in any order, a normal one appended to the queue,
;; an urgent one run at once. From any configuration at most one run step is
;; enabled; every branch is an arrival.
;;
;; Every message is one envelope, (msg mode m from to), and carries its
;; sender's address, so every handler can reply. Directed messages (send,
;; response) run as one transaction. Bubbling ones (notify, request) run as one
;; turn: every hop up to the host, one transaction each, their effects queued
;; until the turn ends (or, with per-hop, one hop per turn).
;;
;; The engine is the metafunctions below. Each later tier adds clauses to them
;; (see engine.rkt). Nonterminals a later tier fills in (step, pstep, sval,
;; snew) are ⊥ here, which no program writes: M0 has no children and no paths
;; but the root's, ().
;;
;; As in the rest of spec/, a metafunction undefined on its input stands for a
;; thrown exception; a transaction is run under try, which turns one into a
;; failure.
(require redex/reduction-semantics "engine.rkt")
(provide Core core-tier tree-> make-config own-clauses
         (all-defined-out))

(define-language Core
  (k f g n x q ::= variable-not-otherwise-mentioned)
  (ι ρ ν ::= natural)
  (v ::= integer string)
  (m ::= (n v ...))
  ;; an instance: kind, identity, locals and child slots
  (c ::= (comp k ι ((g v) ...) ((f sval) ...)))
  (sval ::= ⊥)
  ;; concrete paths, and the paths a handler or an env event writes
  (step ::= ⊥)
  (π ::= (step ...))
  (pstep ::= ⊥)
  (pp ::= (pstep ...))
  ;; host; a component where it was recorded; a send-at's target, with its
  ;; sender and the path relative to it
  (addr ::= host (at π ι) (at π ι ι π))
  (urg ::= normal urgent)
  (r ::= (ok v) (error v) (unhandled))
  (mode ::= send notify (request ρ urg) (response ρ r urg))
  ;; a bubble's last hop (at first, its sender), and once it started, the
  ;; ancestors it is expected to visit
  (ιh ::= ι host)
  (dest ::= addr (hop addr) (hop addr (ιh ...)))
  (message ::= (msg mode m addr dest))
  (hkey ::= (send n) (notify n) (request n) (ok n) (error n) (unhandled n))
  (op ::= + - <)
  (e ::= v x (get g) (op e e) (= e e))
  (act ::= (set g e) (log e)
       (notify n e ...) (request n e ...) (request/urgent n e ...)
       (send-at pp n e ...) (reply n e ...)
       pass stop (answer ok e) (answer error e)
       (if e (act ...) (act ...)))
  (handler ::= (on hkey (x ...) (act ...)))
  (snew ::= ⊥)
  (kdef ::= (kind k (state (g e) ...) ((f snew) ...) (handler ...)))
  (K ::= (kdef ...))
  (host-def ::= (host (handler ...)))
  (event ::= (ev pp n v ...))
  (script ::= event (one-of event ...))
  (policy ::= by-path by-path-checked by-identity)
  (gran ::= turn per-hop)
  (P ::= (program (policy gran) K host-def))
  ;; the engine's own terms: who handles a message and where, the arguments,
  ;; what a handler's actions put out, and how a bubble ends at a hop
  (self ::= c host)
  (here ::= π host)
  (env ::= ((x v) ...))
  (outcome ::= pass stop (answer r))
  (out ::= (log v) (notify m) (request m urg) (send-at (pstep ...) m) (reply m) outcome)
  (o ::= any)
  (σ ::= (world c (message ...) (message ...) (script ...) ν (o ...)))
  (cfg ::= (config P σ)))

(define-tier core-tier Core #:relation tree->
  ;; ---- expressions and actions -----------------------------------------------
  [eval
   [(eval v self env) v]
   [(eval x self (any_1 ... (x v) any_2 ...)) v]
   [(eval (get g) (comp k ι (any_1 ... (g v) any_2 ...) any ...) env) v]
   [(eval (= e_1 e_2) self env) ,(eq (term (eval e_1 self env)) (term (eval e_2 self env)))]
   [(eval (op e_1 e_2) self env) ,(δ (term op) (term (eval e_1 self env)) (term (eval e_2 self env)))]]
  [set-local
   [(set-local (comp k ι (any_1 ... (g v_0) any_2 ...) any ...) g v)
    (comp k ι (any_1 ... (g v) any_2 ...) any ...)]]
  [emit
   [(emit out (self ν (out_1 ...))) (self ν (out out_1 ...))]]
  ;; A handler's actions, in order, on the receiver's draft: the new draft, the
  ;; next fresh id, and what they put out.
  [acts
   [(acts () self env K ν) (self ν ())]
   [(acts ((set g e) act ...) self env K ν) (acts (act ...) (set-local self g (eval e self env)) env K ν)]
   [(acts ((log e) act ...) self env K ν) (emit (log (eval e self env)) (acts (act ...) self env K ν))]
   [(acts ((notify n e ...) act ...) self env K ν)
    (emit (notify (n (eval e self env) ...)) (acts (act ...) self env K ν))]
   [(acts ((request n e ...) act ...) self env K ν)
    (emit (request (n (eval e self env) ...) normal) (acts (act ...) self env K ν))]
   [(acts ((request/urgent n e ...) act ...) self env K ν)
    (emit (request (n (eval e self env) ...) urgent) (acts (act ...) self env K ν))]
   [(acts ((send-at (pstep ...) n e ...) act ...) self env K ν)
    (emit (send-at ((eval-step pstep self env) ...) (n (eval e self env) ...)) (acts (act ...) self env K ν))]
   [(acts ((reply n e ...) act ...) self env K ν)
    (emit (reply (n (eval e self env) ...)) (acts (act ...) self env K ν))]
   [(acts (pass act ...) self env K ν) (emit pass (acts (act ...) self env K ν))]
   [(acts (stop act ...) self env K ν) (emit stop (acts (act ...) self env K ν))]
   [(acts ((answer any_r e) act ...) self env K ν)
    (emit (answer (any_r (eval e self env))) (acts (act ...) self env K ν))]
   [(acts ((if e (act_1 ...) (act_2 ...)) act ...) self env K ν) (acts (act_2 ... act ...) self env K ν)
    (where 0 (eval e self env))]
   [(acts ((if e (act_1 ...) (act_2 ...)) act ...) self env K ν) (acts (act_1 ... act ...) self env K ν)]]

  ;; ---- instances ---------------------------------------------------------------
  [kind-def
   [(kind-def ((name kdef_1 (kind k any ...)) kdef ...) k) kdef_1]
   [(kind-def (kdef_0 kdef ...) k) (kind-def (kdef ...) k)]]
  ;; A fresh instance of k, the locals given overriding its state, with the
  ;; next fresh id.
  [make
   [(make K k ((g_1 v_1) ...) ν)
    ((finish kdef_1 (comp k ν (override ((g (eval e host ())) ...) ((g_1 v_1) ...)) (any_s ...))) ν_1)
    (where (name kdef_1 (kind k (state (g e) ...) (any_d ...) any ...)) (kind-def K k))
    (where ((any_s ...) ν_1) (make-slots K (any_d ...) ,(add1 (term ν))))]]
  [override
   [(override (any_1 ... (g v_0) any_2 ...) ((g v) any ...)) (override (any_1 ... (g v) any_2 ...) (any ...))]
   [(override any ()) any]]
  [make-slots
   [(make-slots K () ν) (() ν)]]
  [finish
   [(finish kdef c) c]]

  ;; ---- trees ---------------------------------------------------------------------
  [child-at
   [(child-at any_1 any_2) none]]
  [put-child
   [(put-child c step c_1) ,(error 'put-child "no steps in this tier")]]
  [children
   [(children (comp k ι any_l (any_s ...) any ...)) (slot-children (any_s ...))]]
  [slot-children
   [(slot-children ()) ()]
   [(slot-children (any_0 any ...)) (slot-children (any ...))]]
  [node-at
   [(node-at c ()) c]
   [(node-at c (step_0 step ...)) (node-at c_1 (step ...)) (where c_1 (child-at c step_0))]
   [(node-at any_1 any_2) none]]
  [put-at
   [(put-at c () c_1) c_1]
   [(put-at c (step_0 step ...) c_1) (put-child c step_0 (put-at (child-at c step_0) (step ...) c_1))]]
  ;; where the instance ι is
  [locate
   [(locate (comp k ι any ...) ι) ()]
   [(locate c ι) (locate-in (children c) ι)]]
  [locate-in
   [(locate-in () ι) none]
   [(locate-in ((step c) any ...) ι) (step step_1 ...) (where (step_1 ...) (locate c ι))]
   [(locate-in (any_0 any ...) ι) (locate-in (any ...) ι)]]
  [ancestors
   [(ancestors c ()) (host)]
   [(ancestors c (step ... step_1)) ((id-of (node-at c (step ...))) ιh ...) (where (ιh ...) (ancestors c (step ...)))]]
  ;; a written step, its expressions evaluated
  [eval-step
   [(eval-step any self env) any]]
  ;; a written step against the instance it starts from: the concrete step
  [concretize
   [(concretize self any) none]]
  [concretize-path
   [(concretize-path c ()) ()]
   [(concretize-path c (pstep_0 pstep ...)) (step_0 step ...)
    (where step_0 (concretize c pstep_0))
    (where (step ...) (concretize-path (child-at c step_0) (pstep ...)))]
   [(concretize-path any_1 any_2) none]]
  [id-of
   [(id-of host) host]
   [(id-of (at π ι any ...)) ι]
   [(id-of (comp k ι any ...)) ι]]

  ;; ---- routing -------------------------------------------------------------------
  ;; (found here self), (stale ι) or orphaned
  [resolve
   [(resolve by-path c (at π ι any ...)) (found π c_1) (where c_1 (node-at c π))]
   [(resolve by-path-checked c (at π ι any ...)) (found π c_1) (where (name c_1 (comp k ι any_1 ...)) (node-at c π))]
   [(resolve by-path-checked c (at π ι any ...)) (stale ι_1) (where (comp k ι_1 any_1 ...) (node-at c π))]
   [(resolve by-identity c (at π ι any ...)) (found π_1 (node-at c π_1)) (where π_1 (locate c ι))]
   [(resolve policy c addr) orphaned]]
  [resolve-in
   [(resolve-in P σ host) (found host host)]
   [(resolve-in (program (policy gran) any_p ...) (world c any_w ...) addr) (resolve policy c addr)]]

  ;; ---- handlers ----------------------------------------------------------------
  [find-handler
   [(find-handler ((name h (on hkey any ...)) any_1 ...) hkey) h]
   [(find-handler (any_0 any ...) hkey) (find-handler (any ...) hkey)]
   [(find-handler () hkey) none]]
  [handler-for
   [(handler-for K (comp k any_c ...) hkey) (find-handler (handler ...) hkey)
    (where (kind k any_s any_d (handler ...) any ...) (kind-def K k))]]
  [handler-of
   [(handler-of (program any_o K (host (handler ...))) host hkey) (find-handler (handler ...) hkey)]
   [(handler-of (program any_o K host-def) c hkey) (handler-for K c hkey)]]
  [key-of
   [(key-of (msg send (n any_a ...) any ...)) (send n)]
   [(key-of (msg notify (n any_a ...) any ...)) (notify n)]
   [(key-of (msg (request any_r ...) (n any_a ...) any ...)) (request n)]
   [(key-of (msg (response ρ (any_r any_v ...) urg) (n any_a ...) any ...)) (any_r n)]]
  [args-of
   [(args-of (msg (response ρ (any_r v) urg) any ...)) (v)]
   [(args-of (msg (response ρ (unhandled) urg) any ...)) ()]
   [(args-of (msg mode (n v ...) any ...)) (v ...)]]

  ;; ---- transactions ----------------------------------------------------------------
  ;; One handler on self at here: run its actions, commit the new self, and
  ;; turn what they put out into messages and observations.
  [transact
   [(transact K c here self message_1 (on hkey (x ...) (act ...)) ν)
    (c_1 (message ...) (o ...) (outcome-of (out ...)) ν_2)
    (where (v ...) (args-of message_1))
    (where (self_1 ν_1 (out ...)) (acts (act ...) self ((x v) ...) K ν))
    (where c_1 (commit c here self_1))
    (where ((message ...) (o ...) ν_2) (dispatch c_1 here (addr-at here self) message_1 (out ...) ν_1))]]
  [commit
   [(commit c host host) c]
   [(commit c π c_1) (put-at c π c_1)]]
  [addr-at
   [(addr-at host host) host]
   [(addr-at π (comp k ι any ...)) (at π ι)]]
  [outcome-of
   [(outcome-of ()) pass]
   [(outcome-of (outcome out ...)) outcome]
   [(outcome-of (out_0 out ...)) (outcome-of (out ...))]]
  ;; What actions put out, in order, as messages from addr: a send-at is
  ;; resolved against the committed tree c, so it can reach an instance this
  ;; very transaction made.
  [dispatch
   [(dispatch c here addr message_0 () ν) (() () ν)]
   [(dispatch c here addr message_0 ((log v) out ...) ν)
    ((message ...) ((log v) o ...) ν_1)
    (where ((message ...) (o ...) ν_1) (dispatch c here addr message_0 (out ...) ν))]
   [(dispatch c here (name a (at any ...)) message_0 ((notify m) out ...) ν)
    (((msg notify m a (hop a)) message ...) (o ...) ν_1)
    (where ((message ...) (o ...) ν_1) (dispatch c here a message_0 (out ...) ν))]
   [(dispatch c here (name a (at any ...)) message_0 ((request m urg) out ...) ν)
    (((msg (request ν urg) m a (hop a)) message ...) ((requested ν) o ...) ν_1)
    (where ((message ...) (o ...) ν_1) (dispatch c here a message_0 (out ...) ,(add1 (term ν))))]
   [(dispatch c here addr message_0 ((send-at (pstep ...) m) out ...) ν)
    (((msg send m addr (target c here addr (pstep ...))) message ...) (o ...) ν_1)
    (where ((message ...) (o ...) ν_1) (dispatch c here addr message_0 (out ...) ν))]
   [(dispatch c here addr (name message_0 (msg mode m_0 addr_0 dest)) ((reply m) out ...) ν)
    (((msg send m addr addr_0) message ...) (o ...) ν_1)
    (where ((message ...) (o ...) ν_1) (dispatch c here addr message_0 (out ...) ν))]
   [(dispatch c here addr message_0 (outcome out ...) ν) (dispatch c here addr message_0 (out ...) ν)]]
  [target
   [(target c host host (pstep ...)) (at π ι)
    (where π (concretize-path c (pstep ...)))
    (where (comp k ι any ...) (node-at c π))]
   [(target c (step_1 ...) (at π_1 ι_1) (pstep ...)) (at (step_1 ... step ...) ι ι_1 (step ...))
    (where (step ...) (concretize-path (node-at c (step_1 ...)) (pstep ...)))
    (where (comp k ι any ...) (node-at c (step_1 ... step ...)))]]

  ;; ---- the world -------------------------------------------------------------------
  [tree-of
   [(tree-of (world c any ...)) c]]
  [observe
   [(observe (world c any_q any_i any_s ν (o ...)) o_1 ...) (world c any_q any_i any_s ν (o ... o_1 ...))]]
  [enqueue
   [(enqueue (world c (message ...) any_i any_s ν any_o) message_1)
    (world c (message ... message_1) any_i any_s ν any_o)]]
  [fly
   [(fly (world c any_q (message ...) any_s ν any_o) message_1)
    (world c any_q (message ... message_1) any_s ν any_o)]]
  ;; A transaction under try: committed, or failed and observed, as if it
  ;; never ran.
  [run-txn
   [(run-txn (program any_o K any_h) (name σ_1 (world c any_q any_i any_s ν any_b)) here self message_1 handler)
    (try-commit σ_1 message_1 ,(attempt (term (transact K c here self message_1 handler ν))))]]
  [try-commit
   [(try-commit σ (msg mode (n any_a ...) any ...) failed) ((observe σ (failed n)) pass)]
   [(try-commit (world c (message_1 ...) any_i any_s ν (o ...)) message_0 (c_1 (message ...) (o_1 ...) outcome ν_1))
    ((world c_1 (message_1 ... message ...) any_i any_s ν_1 (o ... o_1 ...)) outcome)]]

  ;; ---- turns -----------------------------------------------------------------------
  ;; A directed message: resolve its address under the policy, then one
  ;; transaction, or ignored when the receiver has no handler for it.
  [directed
   [(directed P σ (name message_1 (msg mode (n any ...) addr_0 addr)))
    (handle P (observe σ (deliver mode n (id-of addr) (id-of self))) here self message_1)
    (where (found here self) (resolve-in P σ addr))]
   [(directed P σ (msg mode (n any ...) addr_0 addr)) (observe σ (stale mode n (id-of addr) ι))
    (where (stale ι) (resolve-in P σ addr))]
   [(directed P σ (msg mode (n any ...) addr_0 addr)) (observe σ (orphaned mode n (id-of addr)))]]
  [handle
   [(handle P σ here self message_1) σ_1
    (where handler (handler-of P self (key-of message_1)))
    (where (σ_1 outcome) (run-txn P σ here self message_1 handler))]
   [(handle P σ here self (msg mode (n any_a ...) any ...)) (observe σ (ignored mode n (id-of self)))]]
  ;; A bubbling message: resolve its last hop (at first, its sender), then
  ;; visit the parents. The ancestors it should visit are fixed when it starts;
  ;; one that can't find its last hop after starting is lost.
  [bubble
   [(bubble P σ (name message_1 (msg mode m addr_0 (hop addr))))
    (hops P σ message_1 here (ancestors (tree-of σ) here))
    (where (found here any) (resolve-in P σ addr))]
   [(bubble P σ (name message_1 (msg mode m addr_0 (hop addr (ιh ...)))))
    (hops P σ message_1 here (ιh ...))
    (where (found here any) (resolve-in P σ addr))]
   [(bubble P σ (msg mode (n any ...) addr_0 (hop addr (ιh ...)))) (observe σ (lost mode n (id-of addr)))]
   [(bubble P σ (msg mode (n any ...) addr_0 (hop addr))) (observe σ (stale mode n (id-of addr) ι))
    (where (stale ι) (resolve-in P σ addr))]
   [(bubble P σ (msg mode (n any ...) addr_0 (hop addr))) (observe σ (orphaned mode n (id-of addr)))]]
  ;; The next hop is the parent of the last one's path, or the host.
  [hops
   [(hops P σ (name message_1 (msg mode (n any_a ...) any_m ...)) () (ιh_1 ιh ...))
    (end-bubble σ_1 message_1 host outcome)
    (where (σ_1 outcome) (visit P (observe σ (hop mode n host ιh_1)) host host message_1))]
   [(hops P σ (name message_1 (msg mode (n any_a ...) any_m ...)) (step ... step_1) (ιh_1 ιh ...))
    (continue P σ_1 message_1 (step ...) (at (step ...) ι) (ιh ...) outcome)
    (where (name c_1 (comp k ι any ...)) (node-at (tree-of σ) (step ...)))
    (where (σ_1 outcome) (visit P (observe σ (hop mode n ι ιh_1)) (step ...) c_1 message_1))]]
  [visit
   [(visit P σ here self message_1) (run-txn P σ here self message_1 handler)
    (where handler (handler-of P self (key-of message_1)))]
   [(visit P σ here self message_1) (σ pass)]]
  [continue
   [(continue (name P_1 (program (policy turn) any ...)) σ message_1 π addr (ιh ...) pass)
    (hops P_1 σ message_1 π (ιh ...))]
   [(continue (program (policy per-hop) any ...) σ (msg mode m addr_0 dest) π addr (ιh ...) pass)
    (enqueue σ (msg mode m addr_0 (hop addr (ιh ...))))]
   [(continue P σ message_1 π addr any outcome) (end-bubble σ message_1 addr outcome)]]
  ;; stop ends a notification, an answer a request; at the host, a notification
  ;; nobody stopped is unhandled, and a request nobody answered gets unhandled.
  [end-bubble
   [(end-bubble σ (msg notify m any ...) addr stop) σ]
   [(end-bubble σ (msg notify (n any_a ...) any ...) addr pass) (observe σ (unhandled n))]
   [(end-bubble σ (msg (request ρ urg) m addr_0 dest) addr (answer r))
    (fly (observe σ (answered ρ r)) (msg (response ρ r urg) m addr addr_0))]
   [(end-bubble σ (msg (request ρ urg) m addr_0 dest) addr pass)
    (fly (observe σ (answered ρ (unhandled))) (msg (response ρ (unhandled) urg) m host addr_0))]
   [(end-bubble σ (msg mode (n any_a ...) any ...) addr outcome) (observe σ (failed n))]]
  ;; An env event: its route is resolved against the tree as it is now, and it
  ;; runs at once.
  [env-turn
   [(env-turn P σ (ev (pstep ...) n v ...)) (directed P σ (msg send (n v ...) host (at π ι)))
    (where π (concretize-path (tree-of σ) ((eval-step pstep host ()) ...)))
    (where (comp k ι any ...) (node-at (tree-of σ) π))]
   [(env-turn P σ (ev pp n v ...)) (observe σ (no-target n))]]
  [arrive
   [(arrive P σ (name message_1 (msg (response ρ r urgent) any ...))) (directed P σ message_1)]
   [(arrive P σ message_1) (enqueue σ message_1)]]
  [run
   [(run P σ (name message_1 (msg mode m addr (hop any ...)))) (bubble P σ message_1)]
   [(run P σ message_1) (directed P σ message_1)]])
