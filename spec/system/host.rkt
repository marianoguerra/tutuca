#lang racket
;; The host: a reduction relation over the task queue (Host in host.js; Task,
;; NotifyTask, AskTask, EventTask and MessageContext in tasks.js).
;;
;; Read as a TLA+ specification, a configuration is the state and host-> is
;; Next: the disjunction of the actions event, run, fail, resolve, render and
;; settle. Each component's handler is a deterministic action (act in
;; component/action.rkt); the nondeterminism is all here, in which rule fires.
;;
;; A configuration holds the root state, the task queue, async ask replies that
;; have not settled, the DOM (with node identities) and the vnodes it was
;; rendered from, the root it was rendered from, the events still to arrive,
;; the observations so far (handler logs, failed tasks, renders and dev-mode
;; reports), the next fresh node label, and the root as of the last time the
;; queue was empty.
;;
;; One task runs atomically, as one immer transaction: the handler steps the
;; leaf, the new root is set, and every child task's target path is frozen
;; against the new root. Any exception (a failing metafunction) aborts the
;; whole transaction: the root stays, the children are discarded and the
;; failure is observed. That atomicity is how the model covers the runtime's
;; reentrancy guard (_handlingTasks) and its staged child tasks.
;;
;; Dev mode is always on. After each committed task the fields that changed are
;; checked against their schema, and the handler against its message contract.
;; Invariants are checked when the queue is empty, because a task may leave
;; them broken for the tasks it queued: they are invariants of quiescent states.
;;
;; Erased: the 16ms time slice and the setTimeout ticks. Rules are enabled
;; nondeterministically instead: events arrive between any two steps, and a
;; render may happen between any two tasks once the root changed. Host.notify
;; (reports are observations instead), Host.stop and clearTasks, the env behind
;; ctx.now/random/uuid, ctx.event/node, task.parent and sync engines are not
;; modeled.
(require redex/reduction-semantics "../data.rkt" "../vdom/vnode.rkt" "../vdom/dom.rkt"
         "../vdom/morph.rkt" "../component/paths.rkt" "../component/expr.rkt"
         "../component/class.rkt" "../component/action.rkt" "../view/view.rkt"
         "../bind/lower.rkt" "../bind/decode.rkt")
(provide without-ids id-of route-event task-name drag-key-in drag-from drag-after
         Tasks host-> start handle-task eval-arg step-by drain deliver resolve-ask settle-reports
         cfg-root cfg-obs cfg-queue cfg-pending cfg-dom logs)

(define-union-language Bound Routing Lower Action)

(define-extended-language Tasks Bound
  (lbl ::= natural)
  (ldom ::= (element lbl ns tag (prop ...) (ldom ...)) (text lbl string) (comment lbl string)
            (foreign lbl any))
  ;; an event task: its action, the target value and the drag as of the event
  ;; A notification carries whether a hop so far had a handler for it.
  ;; An answer is to an ask, by its name and how it went.
  (kind ::= plain (notify boolean) ask (answer fname answer-kind) (event action value drag?))
  ;; Host.drag, from dragstart to dragend: where the dragged element was rendered.
  (drag? ::= (drag dpath) none)
  ;; name, args, the sender's dispatch path, the target (a dispatch path and a
  ;; selector below it), and the route: fixed for events and replies, frozen at
  ;; commit for every other task.
  (tsk ::= (task kind fname (value ...) dpath target route?))
  (target ::= (at dpath sel))
  ;; A fixed route, with the identity of the component it reached when it was
  ;; fixed (#f when it records none).
  (route? ::= (dpath upath any) none)
  ;; Ask handlers, registered on a scope: args -> result, or a promise. They
  ;; only answer: the runtime gives them the asker's context to read (its
  ;; scope), with nothing to send tasks from, and the model leaves it out.
  (ask-def ::= (fname ask-result))
  (ask-result ::= (ok hx) (error hx) (async (ok hx)) (async (error hx)))
  ;; type, target, and the value of the element with the handler (targetValue
  ;; reads ctx.node, not event.target)
  (evt ::= (event fname addr value))
  ;; Dev-mode reports: stateInvalid with findInvalidFields's issues, and
  ;; messageInvalid with the message's contract issues.
  (obs ::= (log value) (failed fname) (unhandled fname) (stale fname) rendered
           (state-invalid any ...) (message-invalid fname issue ...))
  ;; A committed transaction: the new root, a notification's next hop (none or
  ;; one), the child tasks, the replies pending, what it observed, the next
  ;; fresh identity.
  (outcome ::= (ok value (tsk ...) (tsk ...) (tsk ...) (obs ...) natural) (failed (obs ...)))
  ;; The last slot is the next fresh identity.
  (cfg ::= (host registry (ask-def ...) value (tsk ...) (tsk ...)
                 (ldom ...) (node ...) value (evt ...) (obs ...) lbl value drag? natural)))

;; ---- identity --------------------------------------------------------------
;; A component's identity is its reserved field @: a number fresh for each
;; instance, kept by its updates (next copies self), so a route can tell
;; whether the component at its path is still the one it was for. A component
;; value without one, one a handler made or returned, or one the root starts
;; with, gets a fresh one when it enters the state.
(define (id-of v)
  (match v
    [(list 'comp _ fs ...) (match (assq '@ fs) [(list _ i) i] [_ #f])]
    [_ #f]))
;; v with a fresh identity for each component without one; and the next.
(define (identify v next)
  (match v
    [(list 'arr vs ...)
     (define-values (out n) (identify-all vs next))
     (values `(arr ,@out) n)]
    [(list 'rec (list fs vs) ...)
     (define-values (out n) (identify-all vs next))
     (values `(rec ,@(map list fs out)) n)]
    [(list 'comp cname (list fs vs) ...)
     (define-values (out n) (identify-all vs next))
     (define fields (map list fs out))
     (if (assq '@ fields)
         (values `(comp ,cname ,@fields) n)
         (values `(comp ,cname (@ ,n) ,@fields) (add1 n)))]
    [_ (values v next)]))
(define (without-ids v)
  (match v
    [(list 'comp cname fs ...) `(comp ,cname ,@(for/list ([f fs] #:unless (eq? (car f) '@)) (without-ids f)))]
    [(? list?) (map without-ids v)]
    [_ v]))
(define (identify-all vs next)
  (for/fold ([out '()] [n next] #:result (values (reverse out) n)) ([v vs])
    (define-values (v* n*) (identify v n))
    (values (cons v* out) n*)))

;; Send arguments, against the message context: the target value, the source
;; key and the drag key.
(define-metafunction Tasks
  eval-arg : arg value any any -> value
  [(eval-arg (target-value) value_tv any any_d) value_tv]
  [(eval-arg (source-key) value_tv any any_d) any]
  [(eval-arg (drag-key) value_tv any any_d) any_d]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any any_d) (eval-arg arg_t value_tv any any_d)
   (side-condition (truthy? (term (eval-arg arg_c value_tv any any_d))))]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any any_d) (eval-arg arg_e value_tv any any_d)]
  [(eval-arg value value_tv any any_d) value])

;; Drag.keyIn: the key of the receiver's child the drag started in, as
;; source-key-in is for a message's sender; null with no drag or one from
;; outside the receiver.
(define-metafunction Tasks
  drag-key-in : drag? dpath -> any
  [(drag-key-in none dpath) null]
  [(drag-key-in (drag (dframe_r ... dframe_0 dframe ...)) (dframe_r ...))
   (source-key-in (dframe_r ... dframe_0 dframe ...) (dframe_r ...))]
  [(drag-key-in drag? dpath) null])

;; ---- the message context ---------------------------------------------------
;; What one transaction accumulates: the observations, the handler that ran
;; (for its contract) and what it emitted.
(struct mctx (path source-key task obs handled emitted run-next) #:transparent)

(define (emit! ctx o) (set-box! (mctx-obs ctx) (cons o (unbox (mctx-obs ctx)))))

(define (child-task ctx kind name args base sel)
  `(task ,kind ,name ,args ,(mctx-path ctx) (at ,base ,sel) none))

;; call(): step the handler, then turn its effects into child tasks. Returns
;; (list leaf tasks stop?).
(define (call reg instance name args ctx)
  (define def (term (class-def-of ,reg ,instance)))
  (set-box! (mctx-handled ctx) (list name args))
  (set-box! (mctx-emitted ctx) '())
  (define path (mctx-path ctx))
  (define (emitted! kind n) (set-box! (mctx-emitted ctx) (append (unbox (mctx-emitted ctx)) (list (list kind n)))))
  (define (effects fxs)
    (for/fold ([tasks '()] [stop #f]) ([fx fxs])
      (match fx
        [`(log ,v) (emit! ctx `(log ,v)) (values tasks stop)]
        [`(notify ,n ,vs ...)
         (emitted! 'notify n)
         ;; The root has no ancestors: nobody can handle it.
         (when (null? path) (emit! ctx `(unhandled ,n)))
         (values (if (null? path) tasks
                     (append tasks (list (child-task ctx '(notify #f) n vs (term (to-parent-path ,path)) '()))))
                 stop)]
        [`(ask ,n ,vs ...)
         (emitted! 'ask n)
         (values (append tasks (list (child-task ctx 'ask n vs path '()))) stop)]
        [`(send-at ,n ,vs ,sel)
         (emitted! 'send-at n)
         (values (append tasks (list (child-task ctx 'plain n vs path sel))) stop)]
        [`(forward-at ,sel)
         (match-define `(task ,_ ,tn ,targs ,_ ,_ ,_) (mctx-task ctx))
         (emitted! 'send-at tn)
         (values (append tasks (list (child-task ctx 'plain tn targs path sel))) stop)]
        ['(stop) (values tasks #t)])))
  (match (term (act ,def ,instance ,name ,args ,(mctx-source-key ctx)))
    [`(ok ,next ,fxs) (let-values ([(tasks stop) (effects fxs)]) (list next tasks stop))]
    [`(aborted ,fxs) (effects fxs) (error 'handler "~a threw" name)]))

(define (find-handler reg instance name)
  (handler-of (term (class-def-of ,reg ,instance)) name))

;; run(): a missing handler keeps next, and is observed (Host.notify("unhandled")).
(define (run reg instance key args ctx)
  (cond [(find-handler reg instance key) (call reg instance key args ctx)]
        [else (emit! ctx `(unhandled ,(key-name key))) (list instance '() #f)]))


;; task.run for each kind: (list leaf tasks stop? replies)
(define (run-kind reg asks instance task ctx)
  (match-define `(task ,kind ,name ,args ,source ,_ ,_) task)
  (match kind
    ['plain (append (run reg instance name args ctx) '(()))]
    ;; An ancestor without a handler passes a notification on, silently. It
    ;; ends at stop, or at the root, where it's observed unhandled, once, if no
    ;; hop handled it.
    [`(notify ,handled-before)
     (define found (find-handler reg instance name))
     (define handled (or handled-before (and found #t)))
     (match-define (list leaf tasks stop)
       (if found (call reg instance name args ctx) (list instance '() #f)))
     (define path (mctx-path ctx))
     (when (and (null? path) (not stop) (not handled)) (emit! ctx `(unhandled ,name)))
     ;; The next hop runs right after this one (run-next), before anything else queued: a
     ;; bubble is one turn, so it visits the ancestors its sender had when it
     ;; started, and what each hop sends waits until it ends.
     (unless (or (null? path) stop)
       (set-box! (mctx-run-next ctx)
                 (list `(task (notify ,handled) ,name ,args ,source (at ,(term (to-parent-path ,path)) ()) none))))
     (list leaf tasks stop '())]
    ;; An ask runs no handler on the asker: it starts the scope's ask handler,
    ;; and the answer comes back as a reply task of its own, routed to the asker
    ;; (its path and identity): one answered now runs next, ahead of the queue,
    ;; one answered later is pending. Either way a reply that fails fails only
    ;; itself.
    ['ask
     (define (answer-task outcome args)
       `(task (answer ,name ,outcome) ,(key-name `(answer ,name ,outcome)) ,args ,source (at ,source ())
              (,@(term (route-for ,source)) ,(id-of instance))))
     (define (value hx) (term (eval-hx ((args (arr ,@args))) ,hx)))
     (define (now t) (set-box! (mctx-run-next ctx) (list t)) (list instance '() #f '()))
     (match (lookup-named asks name)
       [#f (now (answer-task 'unhandled '()))]
       [`(,_ (ok ,hx)) (now (answer-task 'ok (list (value hx))))]
       [`(,_ (error ,hx)) (now (answer-task 'error (list (value hx))))]
       [`(,_ (async (,result ,hx)))
        (list instance '() #f (list (answer-task result (list (value hx)))))])]
    ;; An answer goes to the handler in the asker's answers, never to a message
    ;; in on: a send of the same name can't forge one.
    [`(answer ,ask ,outcome) (append (run reg instance `(answer ,ask ,outcome) args ctx) '(()))]
    [`(event (send ,_ ,arg-terms ...) ,tv ,drag)
     (define drag-key (term (drag-key-in ,drag ,(mctx-path ctx))))
     (define args (for/list ([a arg-terms]) (term (eval-arg ,a ,tv ,(mctx-source-key ctx) ,drag-key))))
     ;; EventTask.run sets this.args before the handler runs, so forwardAt sends them.
     (match-define `(task ,k ,n ,_ ,rest ...) task)
     (define ctx/args (struct-copy mctx ctx [task `(task ,k ,n ,args ,@rest)]))
     ;; A missing handler is a no-op that's observed, as for any message; for
     ;; well-formed views (wf.rkt) it never happens.
     (append (run reg instance name args ctx/args) '(()))]))

;; prepareTask: a task without a route freezes its selector against the value
;; its base resolves to in the root; the frozen frames extend the base.
(define (prepare root task)
  (match task
    [`(task ,kind ,name ,args ,source (at ,base ,sel) none)
     (define start (term (get-in (resolve ,base) ,root)))
     (define dispatch (append base (term (freeze-sel ,sel ,start))))
     (match-define (list path upath) (term (route-for ,dispatch)))
     `(task ,kind ,name ,args ,source (at ,base ,sel) (,path ,upath ,(id-of (term (get-in ,upath ,root)))))]
    [_ task]))

;; checkState and checkMessage after a commit: the changed fields, then the
;; contract of the handler that ran, if one did.
(define (checks reg old-root new-root update-path instance ctx)
  (define fields (term (invalid-in (classes-of ,reg) ,new-root ,old-root (fields))))
  (define message
    (match (unbox (mctx-handled ctx))
      [#f '()]
      [(list name args)
       (define issues
         (term (message-issues (class-def-of ,reg ,instance) ,name ,instance
                               (get-in ,update-path ,new-root) ,args ,(mctx-source-key ctx)
                               ,(unbox (mctx-emitted ctx)))))
       (if (null? issues) '() (list `(message-invalid ,(key-name name) ,@issues)))]))
  (append (if (null? fields) '() (list `(state-invalid ,@fields))) message))

;; Host.handleTask: one transaction.
(define-metafunction Tasks
  handle-task : registry (ask-def ...) value tsk natural -> outcome
  [(handle-task registry (ask-def ...) value tsk natural)
   ,(let ([obs (box '())])
      (with-handlers ([exn:fail? (λ (_) `(failed ,(reverse (unbox obs))))])
       (let/ec return
        (match-define `(task ,_ ,name ,_ ,source ,_ (,path ,update-path ,id)) (term tsk))
        (define root (term value))
        (define instance (term (get-in ,update-path ,root)))
        ;; Another component took its place (it was replaced, or a list
        ;; shifted): the message was for the one before, so it's dropped and
        ;; observed, not given to this one.
        (when (and id (not (equal? (id-of instance) id)))
          (return `(ok ,root () () () ((stale ,name)) ,(term natural))))
        (define cpath (term (to-component-path ,path)))
        (define ctx (mctx cpath (term (source-key-in ,source ,cpath)) (term tsk) obs (box #f) (box '()) (box '())))
        (match-define (list leaf tasks _ replies)
          (run-kind (term registry) (term (ask-def ...)) instance (term tsk) ctx))
        (define-values (new-root next)
          (identify (term (set-in ,update-path ,root ,leaf)) (term natural)))
        (define children (for/list ([t tasks]) (prepare new-root t)))
        (define hops (for/list ([t (unbox (mctx-run-next ctx))]) (prepare new-root t)))
        (define reports (checks (term registry) root new-root update-path instance ctx))
        `(ok ,new-root ,hops ,children ,replies ,(append (reverse (unbox obs)) reports) ,next))))])

(define-metafunction Tasks
  route-event : registry value (ldom ...) evt drag? -> (tsk ...)
  [(route-event registry value (ldom ...) (event fname addr value_tv) drag?)
   ,(match (with-handlers ([exn:fail? (λ (_) 'none)])
             (term (event-info registry value (erase-all (ldom ...)) fname addr)))
      ['none '()]
      [(list (list 'on _ action) (list path upath))
       ;; Fixed now, with the identity of the component the event reached.
       (define route `(,path ,upath ,(id-of (term (get-in ,upath value)))))
       (list `(task (event ,action ,(term value_tv) ,(term drag?)) ,(second action) () ,path (at ,path ()) ,route))])])

;; startDrag on dragstart: the closest draggable="true" element, the target or
;; an ancestor, rendered in a component, is what's dragged; otherwise the drag
;; stays as it was.
(define-metafunction Tasks
  drag-from : (ldom ...) evt drag? -> drag?
  [(drag-from (ldom ...) (event dragstart addr value) drag?)
   ,(let* ([doms (term (erase-all (ldom ...)))]
           [a (for/first ([n (in-range (length (term addr)) 0 -1)]
                          #:when (match (term (node-at ,doms ,(take (term addr) n)))
                                   [`(element ,_ ,_ ,props ,_) (equal? (assq 'draggable props) '(draggable "true"))]
                                   [_ #f]))
                (take (term addr) n))]
           [path (and a (term (path-of ,doms ,a)))])
      (if (and path (not (eq? path 'none))) `(drag ,path) (term drag?)))]
  [(drag-from (ldom ...) evt drag?) drag?])

;; endDrag, after dragend is handled.
(define-metafunction Tasks
  drag-after : evt drag? -> drag?
  [(drag-after (event dragend addr value) drag?) none]
  [(drag-after evt drag?) drag?])

(define-metafunction Tasks
  task-name : tsk -> fname
  [(task-name (task kind fname any ...)) fname])

;; checkSettled: the invariants of what changed since the queue was last empty.
(define-metafunction Tasks
  settle-reports : registry value value -> (obs ...)
  [(settle-reports registry value value_s)
   ,(let ([issues (term (invalid-in (classes-of registry) value value_s (invariants)))])
      (if (null? issues) '() (list `(state-invalid ,@issues))))])

(define host->
  (reduction-relation
   Tasks #:domain cfg
   ;; handleEvent: route against the current DOM and root; the route is fixed
   ;; now, and so is the drag the handler's dragKey reads (a dragstart starts
   ;; it first, a dragend ends it after).
   (--> (host registry any_a value (tsk ...) any_p (ldom ...) any_v any_r
              (evt_0 evt ...) any_o lbl any_s drag? natural)
        (host registry any_a value (tsk ... tsk_e ...) any_p (ldom ...) any_v any_r
              (evt ...) any_o lbl any_s (drag-after evt_0 drag?_now) natural)
        (where drag?_now (drag-from (ldom ...) evt_0 drag?))
        (where (tsk_e ...) (route-event registry value (ldom ...) evt_0 drag?_now))
        event)
   ;; A committed transaction: the new root; a notification's next hop first,
   ;; then the tasks queued before, then its children, in order.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) (tsk_p ...) any_d any_v any_r
              any_e (obs ...) lbl any_s any_g natural)
        (host registry (ask-def ...) value_new (tsk_h ... tsk ... tsk_c ...) (tsk_p ... tsk_r ...) any_d any_v any_r
              any_e (obs ... obs_new ...) lbl any_s any_g natural_new)
        (where (ok value_new (tsk_h ...) (tsk_c ...) (tsk_r ...) (obs_new ...) natural_new)
               (handle-task registry (ask-def ...) value tsk_0 natural))
        run)
   ;; An aborted transaction: nothing but its observations survives.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) any_p any_d any_v any_r
              any_e (obs ...) lbl any_s any_g natural)
        (host registry (ask-def ...) value (tsk ...) any_p any_d any_v any_r
              any_e (obs ... obs_new ... (failed (task-name tsk_0))) lbl any_s any_g natural)
        (where (failed (obs_new ...)) (handle-task registry (ask-def ...) value tsk_0 natural))
        fail)
   ;; A pending async ask settles, in any order: its reply joins the queue.
   (--> (host registry any_a value (tsk ...) (tsk_1 ... tsk_r tsk_2 ...) any_d any_v any_r
              any_e any_o lbl any_s any_g natural)
        (host registry any_a value (tsk ... tsk_r) (tsk_1 ... tsk_2 ...) any_d any_v any_r
              any_e any_o lbl any_s any_g natural)
        resolve)
   ;; Host.render: morph the DOM from the last vnodes to the root's.
   (--> (host registry any_a value any_q any_p (ldom ...) (node_old ...) value_r
              any_e (obs ...) lbl any_s any_g natural)
        (host registry any_a value any_q any_p (ldom_new ...) (node_new ...) value
              any_e (obs ... rendered) lbl_new any_s any_g natural)
        (side-condition (not (equal? (term value) (term value_r))))
        (where (node_new ...) (lower-root registry value))
        (where ((ldom_new ...) lbl_new)
               (morph-children (ldom ...) (node_old ...) (node_new ...) ,HTML-NS lbl))
        render)
   ;; checkSettled: the queue is empty and the root changed since it last was.
   (--> (host registry any_a value () any_p any_d any_v any_r any_e (obs ...) lbl value_s any_g natural)
        (host registry any_a value () any_p any_d any_v any_r any_e (obs ... obs_new ...) lbl value any_g natural)
        (side-condition (not (equal? (term value) (term value_s))))
        (where (obs_new ...) (settle-reports registry value value_s))
        settle)))

;; Host.start: register the components, check the whole root, and mount its
;; first render.
(define (start components root* #:asks [asks '()] #:events [events '()])
  (define-values (root next-id) (identify root* 1))
  (define reg (term (register-components ,components)))
  (define vdom (term (lower-root ,reg ,root)))
  (define issues (term (invalid-in (classes-of ,reg) ,root null (fields invariants))))
  (define reports (if (null? issues) '() (list `(state-invalid ,@issues))))
  (match-define (list doms next) (term (mount-all ,vdom ,HTML-NS 0)))
  `(host ,reg ,asks ,root () () ,doms ,vdom ,root ,events ,reports ,next ,root none ,next-id))

(define (cfg-root c) (fourth c))
(define (cfg-queue c) (fifth c))
(define (cfg-pending c) (sixth c))
(define (cfg-dom c) (seventh c))
(define (cfg-obs c) (list-ref c 10))
(define (logs c) (for/list ([o (cfg-obs c)] #:when (and (pair? o) (eq? (car o) 'log))) (second o)))

;; Take the step a given rule allows (the rules are deterministic on their own,
;; except resolve, which takes the first pending reply), or #f.
(define (step-by rule c)
  (define next (for/first ([r (apply-reduction-relation/tag-with-names host-> c)]
                           #:when (equal? (first r) (symbol->string rule)))
                 (second r)))
  next)

;; Deliver the next n events without running tasks (queueEvents in the tests).
(define (deliver c [n 1])
  (if (zero? n) c (deliver (step-by 'event c) (sub1 n))))

;; Run the queue empty, then render if the root changed, then check the
;; settled state (handleTasks).
(define (drain c)
  (cond [(pair? (cfg-queue c)) (drain (or (step-by 'run c) (step-by 'fail c)))]
        [else (let ([c (or (step-by 'render c) c)]) (or (step-by 'settle c) c))]))

(define (resolve-ask c) (step-by 'resolve c))

(module+ test
  (require rackunit)
  (define counter
    (term ((component Counter
             (views ("main" (h 1 "button" ((on click (send inc (target-value)))) (field n))))
             (on (inc (by) (step (next (n) (+ (get self n) by)) (log (get next n)))))))))
  (define c0 (start counter '(comp Counter (n 0)) #:events '((event click (1) 2))))

  ;; An event routes to the button's handler; the task commits; render morphs
  ;; the same button node.
  (define c1 (drain (deliver c0)))
  ;; The root has its identity, @, since start.
  (test-equal (cfg-root c1) '(comp Counter (@ 1) (n 2)))
  (test-equal (logs c1) '(2))
  (test-equal (term (erase-all ,(cfg-dom c1)))
              (term (render (lower-root ,(second c1) (comp Counter (@ 1) (n 2))))))
  (test-equal (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c1)))
              (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c0))))

  ;; A message with no handler keeps the instance, and is observed.
  (test-equal (term (handle-task ,(second c0) () (comp Counter (@ 1) (n 0))
                                 (task plain nope () () (at () ()) (() () 1)) 2))
              '(ok (comp Counter (@ 1) (n 0)) () () () ((unhandled nope)) 2))

  ;; A route records the identity of the component it was for: another one at
  ;; its path doesn't get the message, which is observed stale.
  (test-equal (term (handle-task ,(second c0) () (comp Counter (@ 7) (n 0))
                                 (task plain inc (1) () (at () ()) (() () 1)) 8))
              '(ok (comp Counter (@ 7) (n 0)) () () () ((stale inc)) 8))

  ;; Events that hit nothing are dropped.
  (test-equal (cfg-queue (deliver (start counter '(comp Counter (n 0)) #:events '((event input (1) 0)))))
              '())

  ;; A failing handler aborts its transaction: the root stays and the children
  ;; it sent are discarded, but its logs, like any JS side effect, remain.
  (define failing
    (term ((component Root
             (views ("main" "x"))
             (on (go () (step (next (n) 1) (log "before") (send-at go () ()) (fail "boom"))))))))
  (define cf (drain `(host ,(term (register-components ,failing)) () (comp Root (n 0))
                           ((task plain go () () (at () ()) (() () #f))) () () () (comp Root (n 0)) () () 0
                           (comp Root (n 0)) none 1)))
  (test-equal (cfg-root cf) '(comp Root (n 0)))
  ;; A drag: dragstart on a draggable item remembers where it was rendered, the
  ;; drop on another item bubbles to the list (no item handles it) and reads
  ;; the dragged item's key with dragKey, and dragend forgets the drag.
  (define drag-classes
    '((component Item (views ("main" (h 1 "li" ((draggable "true")) "x"))))
      (component List
        (views ("main" (h 2 "ul" ((on drop (send moved (drag-key) (source-key))))
                          (each (field items) (render-it none) none))))
        (on (moved (from to) (step (next (got) (mk-arr from to))))))))
  (define drag-root '(comp List (got null) (items (arr (comp Item) (comp Item) (comp Item)))))
  (define items
    (addresses (term (erase-all ,(cfg-dom (start drag-classes drag-root))))
               (λ (d) (equal? (third d) "li"))))
  (define d1 (drain (deliver (start drag-classes drag-root
                                    #:events `((event dragstart ,(first items) null)
                                               (event drop ,(third items) null)
                                               (event dragend ,(first items) null)))
                             3)))
  (test-equal (cfg-obs d1) '(rendered))
  (test-equal (without-ids (cfg-root d1)) '(comp List (got (arr 0 2)) (items (arr (comp Item) (comp Item) (comp Item)))))
  (test-equal (list-ref d1 13) 'none)
  (test-equal (cfg-obs cf) '((log "before") (failed go)))
  (test-equal (cfg-queue cf) '())

  ;; Dev mode: the fields a task changed are checked after it commits, and the
  ;; handler against its contract; invariants wait until the queue is empty,
  ;; so a task may break them for a task it queued to repair.
  (define checked
    (term ((component Counter
             (fields (n (Refine Number (max 3))) (pending Boolean))
             (invariants (settled (not (get self pending))))
             (views ("main" (h 1 "button" ((on click (send inc 1))) (field n))))
             (on (inc (by)
                      (args (Refine Number (min 0)))
                      (post (= (get next n) (+ (get self n) by)))
                      (emits (send-at fix))
                      (step (next (n) (+ (get self n) (+ by by))) (next (pending) #t) (send-at fix () ())))
                 (fix () (cases ((< (get self n) 3) (step (next (pending) #f))))))))))
  (define (click-checked root)
    (drain (deliver (start checked root #:events '((event click (1) null))))))
  ;; Reported once at start: an undeclared field, and a broken invariant.
  (test-equal (without-ids (cfg-obs (start checked '(comp Counter (n 0) (pending #t) (extra 1)))))
              '((state-invalid (("extra") Counter extra 1 "undeclared")
                               (() Counter null (comp Counter (n 0) (pending #t) (extra 1)) "invariant:settled"))))
  ;; inc adds its step twice, so post is broken. It leaves pending set for the
  ;; fix it queued; that is not reported, because once the queue is empty the
  ;; invariant holds again.
  (define fixed (click-checked '(comp Counter (n 0) (pending #f))))
  (test-equal (without-ids (cfg-root fixed)) '(comp Counter (n 2) (pending #f)))
  (test-equal (cfg-obs fixed) '((message-invalid inc "post") rendered))
  ;; From 2, n goes past max(3) and the fix has no step: the settled state
  ;; breaks the invariant.
  (define broken (click-checked '(comp Counter (n 2) (pending #f))))
  (test-equal (without-ids (cfg-obs broken))
              '((state-invalid (("n") Counter n 4 "invalid"))
                (message-invalid inc "post")
                (failed fix)
                rendered
                (state-invalid (() Counter null (comp Counter (n 4) (pending #t)) "invariant:settled"))))
  (test-results))
