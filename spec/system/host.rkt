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
(provide route-event task-name
         Tasks host-> start handle-task eval-arg step-by drain deliver resolve-ask settle-reports
         cfg-root cfg-obs cfg-queue cfg-pending cfg-dom logs)

(define-union-language Bound Routing Lower Action)

(define-extended-language Tasks Bound
  (lbl ::= natural)
  (ldom ::= (element lbl ns tag (prop ...) (ldom ...)) (text lbl string) (comment lbl string)
            (foreign lbl any))
  (kind ::= plain notify ask (event action value))  ; an event task: its action and target value
  ;; name, args, the sender's dispatch path, the target (a dispatch path and a
  ;; selector below it), and the route: fixed for events and replies, frozen at
  ;; commit for every other task.
  (tsk ::= (task kind fname (value ...) dpath target route?))
  (target ::= (at dpath sel))
  (route? ::= route none)
  ;; Ask handlers, registered on a scope: args -> result, or a promise. The
  ;; runtime also passes ctx, so an ask handler can send tasks; the model does not.
  (ask-def ::= (fname ask-result))
  (ask-result ::= (ok hx) (error hx) (async (ok hx)) (async (error hx)))
  ;; type, target, and the value of the element with the handler (targetValue
  ;; reads ctx.node, not event.target)
  (evt ::= (event fname addr value))
  ;; Dev-mode reports: stateInvalid with findInvalidFields's issues, and
  ;; messageInvalid with the message's contract issues.
  (obs ::= (log value) (failed fname) rendered
           (state-invalid any ...) (message-invalid fname issue ...))
  (outcome ::= (ok value (tsk ...) (tsk ...) (obs ...)) (failed (obs ...)))
  (cfg ::= (host registry (ask-def ...) value (tsk ...) (tsk ...)
                 (ldom ...) (node ...) value (evt ...) (obs ...) lbl value)))

;; Send arguments, against the message context.
(define-metafunction Tasks
  eval-arg : arg value any -> value
  [(eval-arg (target-value) value_tv any) value_tv]
  [(eval-arg (source-key) value_tv any) any]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any) (eval-arg arg_t value_tv any)
   (side-condition (truthy? (term (eval-arg arg_c value_tv any))))]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any) (eval-arg arg_e value_tv any)]
  [(eval-arg value value_tv any) value])

;; ---- the message context ---------------------------------------------------
;; What one transaction accumulates: the observations, the handler that ran
;; (for its contract) and what it emitted.
(struct mctx (path source-key task obs handled emitted) #:transparent)

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
         (values (if (null? path) tasks
                     (append tasks (list (child-task ctx 'notify n vs (term (to-parent-path ,path)) '()))))
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

;; run(): a missing handler warns and keeps next.
(define (run reg instance name args ctx)
  (if (find-handler reg instance name) (call reg instance name args ctx) (list instance '() #f)))

(define (suffixed name suffix) (string->symbol (format "~a~a" name suffix)))

;; task.run for each kind: (list leaf tasks stop? replies)
(define (run-kind reg asks instance task ctx)
  (match-define `(task ,kind ,name ,args ,source ,_ ,_) task)
  (match kind
    ['plain (append (run reg instance name args ctx) '(()))]
    ['notify
     (match-define (list leaf tasks stop) (run reg instance name args ctx))
     (define path (mctx-path ctx))
     (define bubble (if (or (null? path) stop) '()
                        (list `(task notify ,name ,args ,source (at ,(term (to-parent-path ,path)) ()) none))))
     (list leaf (append tasks bubble) stop '())]
    ['ask
     (define (reply suffix hx)
       (define v (term (eval-hx ((args (arr ,@args))) ,hx)))
       (list (suffixed name suffix) v))
     (match (lookup-named asks name)
       [#f (append (run reg instance (suffixed name "HandlerNotFound") '() ctx) '(()))]
       [`(,_ (ok ,hx)) (match-let ([(list n v) (reply "ReplyOk" hx)])
                         (append (run reg instance n (list v) ctx) '(())))]
       [`(,_ (error ,hx)) (match-let ([(list n v) (reply "ReplyError" hx)])
                            (append (run reg instance n (list v) ctx) '(())))]
       [`(,_ (async (,result ,hx)))
        (match-define (list n v) (reply (if (eq? result 'ok) "ReplyOk" "ReplyError") hx))
        (list instance '() #f
              (list `(task plain ,n (,v) ,source (at ,source ()) ,(term (route-for ,source)))))])]
    [`(event (send ,_ ,arg-terms ...) ,tv)
     (define args (for/list ([a arg-terms]) (term (eval-arg ,a ,tv ,(mctx-source-key ctx)))))
     (unless (find-handler reg instance name) (error 'event "no handler ~a" name)) ; lint guarantees it exists
     ;; EventTask.run sets this.args before the handler runs, so forwardAt sends them.
     (match-define `(task ,k ,n ,_ ,rest ...) task)
     (define ctx/args (struct-copy mctx ctx [task `(task ,k ,n ,args ,@rest)]))
     (append (call reg instance name args ctx/args) '(()))]))

;; prepareTask: a task without a route freezes its selector against the value
;; its base resolves to in the root; the frozen frames extend the base.
(define (prepare root task)
  (match task
    [`(task ,kind ,name ,args ,source (at ,base ,sel) none)
     (define start (term (get-in (resolve ,base) ,root)))
     (define dispatch (append base (term (freeze-sel ,sel ,start))))
     `(task ,kind ,name ,args ,source (at ,base ,sel) ,(term (route-for ,dispatch)))]
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
       (if (null? issues) '() (list `(message-invalid ,name ,@issues)))]))
  (append (if (null? fields) '() (list `(state-invalid ,@fields))) message))

;; Host.handleTask: one transaction.
(define-metafunction Tasks
  handle-task : registry (ask-def ...) value tsk -> outcome
  [(handle-task registry (ask-def ...) value tsk)
   ,(let ([obs (box '())])
      (with-handlers ([exn:fail? (λ (_) `(failed ,(reverse (unbox obs))))])
        (match-define `(task ,_ ,_ ,_ ,source ,_ (,path ,update-path)) (term tsk))
        (define root (term value))
        (define instance (term (get-in ,update-path ,root)))
        (define cpath (term (to-component-path ,path)))
        (define ctx (mctx cpath (term (source-key-in ,source ,cpath)) (term tsk) obs (box #f) (box '())))
        (match-define (list leaf tasks _ replies)
          (run-kind (term registry) (term (ask-def ...)) instance (term tsk) ctx))
        (define new-root (term (set-in ,update-path ,root ,leaf)))
        (define children (for/list ([t tasks]) (prepare new-root t)))
        (define reports (checks (term registry) root new-root update-path instance ctx))
        `(ok ,new-root ,children ,replies ,(append (reverse (unbox obs)) reports))))])

(define-metafunction Tasks
  route-event : registry value (ldom ...) evt -> (tsk ...)
  [(route-event registry value (ldom ...) (event fname addr value_tv))
   ,(match (with-handlers ([exn:fail? (λ (_) 'none)])
             (term (event-info registry value (erase-all (ldom ...)) fname addr)))
      ['none '()]
      [(list (list 'on _ action) (and route (list path _)))
       (list `(task (event ,action ,(term value_tv)) ,(second action) () ,path (at ,path ()) ,route))])])

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
   ;; handleEvent: route against the current DOM and root; the route is fixed now.
   (--> (host registry any_a value (tsk ...) any_p (ldom ...) any_v any_r
              (evt_0 evt ...) any_o lbl any_s)
        (host registry any_a value (tsk ... tsk_e ...) any_p (ldom ...) any_v any_r
              (evt ...) any_o lbl any_s)
        (where (tsk_e ...) (route-event registry value (ldom ...) evt_0))
        event)
   ;; A committed transaction: the new root, then its children, in order.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) (tsk_p ...) any_d any_v any_r
              any_e (obs ...) lbl any_s)
        (host registry (ask-def ...) value_new (tsk ... tsk_c ...) (tsk_p ... tsk_r ...) any_d any_v any_r
              any_e (obs ... obs_new ...) lbl any_s)
        (where (ok value_new (tsk_c ...) (tsk_r ...) (obs_new ...))
               (handle-task registry (ask-def ...) value tsk_0))
        run)
   ;; An aborted transaction: nothing but its observations survives.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) any_p any_d any_v any_r
              any_e (obs ...) lbl any_s)
        (host registry (ask-def ...) value (tsk ...) any_p any_d any_v any_r
              any_e (obs ... obs_new ... (failed (task-name tsk_0))) lbl any_s)
        (where (failed (obs_new ...)) (handle-task registry (ask-def ...) value tsk_0))
        fail)
   ;; A pending async ask settles, in any order: its reply joins the queue.
   (--> (host registry any_a value (tsk ...) (tsk_1 ... tsk_r tsk_2 ...) any_d any_v any_r
              any_e any_o lbl any_s)
        (host registry any_a value (tsk ... tsk_r) (tsk_1 ... tsk_2 ...) any_d any_v any_r
              any_e any_o lbl any_s)
        resolve)
   ;; Host.render: morph the DOM from the last vnodes to the root's.
   (--> (host registry any_a value any_q any_p (ldom ...) (node_old ...) value_r
              any_e (obs ...) lbl any_s)
        (host registry any_a value any_q any_p (ldom_new ...) (node_new ...) value
              any_e (obs ... rendered) lbl_new any_s)
        (side-condition (not (equal? (term value) (term value_r))))
        (where (node_new ...) (lower-root registry value))
        (where ((ldom_new ...) lbl_new)
               (morph-children (ldom ...) (node_old ...) (node_new ...) ,HTML-NS lbl))
        render)
   ;; checkSettled: the queue is empty and the root changed since it last was.
   (--> (host registry any_a value () any_p any_d any_v any_r any_e (obs ...) lbl value_s)
        (host registry any_a value () any_p any_d any_v any_r any_e (obs ... obs_new ...) lbl value)
        (side-condition (not (equal? (term value) (term value_s))))
        (where (obs_new ...) (settle-reports registry value value_s))
        settle)))

;; Host.start: register the components, check the whole root, and mount its
;; first render.
(define (start components root #:asks [asks '()] #:events [events '()])
  (define reg (term (register-components ,components)))
  (define vdom (term (lower-root ,reg ,root)))
  (define issues (term (invalid-in (classes-of ,reg) ,root null (fields invariants))))
  (define reports (if (null? issues) '() (list `(state-invalid ,@issues))))
  (match-define (list doms next) (term (mount-all ,vdom ,HTML-NS 0)))
  `(host ,reg ,asks ,root () () ,doms ,vdom ,root ,events ,reports ,next ,root))

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
  (test-equal (cfg-root c1) '(comp Counter (n 2)))
  (test-equal (logs c1) '(2))
  (test-equal (term (erase-all ,(cfg-dom c1)))
              (term (render (lower-root ,(second c1) (comp Counter (n 2))))))
  (test-equal (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c1)))
              (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c0))))

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
                           ((task plain go () () (at () ()) (() ()))) () () () (comp Root (n 0)) () () 0
                           (comp Root (n 0)))))
  (test-equal (cfg-root cf) '(comp Root (n 0)))
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
  (test-equal (cfg-obs (start checked '(comp Counter (n 0) (pending #t) (extra 1))))
              '((state-invalid (("extra") Counter extra 1 "undeclared")
                               (() Counter null (comp Counter (n 0) (pending #t) (extra 1)) "invariant:settled"))))
  ;; inc adds its step twice, so post is broken. It leaves pending set for the
  ;; fix it queued; that is not reported, because once the queue is empty the
  ;; invariant holds again.
  (define fixed (click-checked '(comp Counter (n 0) (pending #f))))
  (test-equal (cfg-root fixed) '(comp Counter (n 2) (pending #f)))
  (test-equal (cfg-obs fixed) '((message-invalid inc "post") rendered))
  ;; From 2, n goes past max(3) and the fix has no step: the settled state
  ;; breaks the invariant.
  (define broken (click-checked '(comp Counter (n 2) (pending #f))))
  (test-equal (cfg-obs broken)
              '((state-invalid (("n") Counter n 4 "invalid"))
                (message-invalid inc "post")
                (failed fix)
                rendered
                (state-invalid (() Counter null (comp Counter (n 4) (pending #t)) "invariant:settled"))))
  (test-results))
