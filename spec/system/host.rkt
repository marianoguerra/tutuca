#lang racket
;; The host: a reduction relation over the task queue (Host in host.js; Task,
;; NotifyTask, AskTask, EventTask and MessageContext in tasks.js).
;;
;; A configuration holds the root state, the task queue, async ask replies that
;; have not settled, the DOM (with node identities) and the vnodes it was
;; rendered from, the root it was rendered from, the events still to arrive,
;; and the observations so far: handler logs, failed tasks and renders.
;;
;; One task runs atomically, as one immer transaction: the handler edits a
;; draft of the leaf, the new root is set, and every child task's target path
;; is frozen against the new root. Any exception (a failing metafunction)
;; aborts the whole transaction: the root stays, the children are discarded
;; and the failure is observed. That atomicity is how the model covers the
;; runtime's reentrancy guard (_handlingTasks) and its staged child tasks.
;;
;; Erased: the 16ms time slice and the setTimeout ticks. Rules are enabled
;; nondeterministically instead: events arrive between any two steps, and a
;; render may happen between any two tasks once the root changed. Dev checks
;; (schemas, invariants, message contracts), Host.notify, Host.stop and
;; clearTasks, the env behind ctx.now/random/uuid, ctx.event/node, task.parent
;; and sync engines are not modeled.
(require redex/reduction-semantics "data.rkt" "core.rkt" "dom.rkt" "paths.rkt" "host.rkt"
         "view.rkt" "morph.rkt" "routing.rkt")
(provide route-event task-name
         Tasks host-> start handle-task eval-arg step-by drain deliver resolve-ask
         cfg-root cfg-obs cfg-queue cfg-pending cfg-dom logs)

(define-extended-language Tasks Routing
  (lbl ::= natural)
  (ldom ::= (element lbl ns tag (prop ...) (ldom ...)) (text lbl string) (comment lbl string))
  (kind ::= plain notify ask (event action value))  ; an event task: its action and target value
  ;; name, args, the sender's dispatch path, the target (a dispatch path and a
  ;; selector below it), and the route: fixed for events and replies, frozen at
  ;; commit for every other task.
  (tsk ::= (task kind fname (value ...) dpath target route?))
  (target ::= (at dpath sel))
  (route? ::= route none)
  ;; type, target, and the value of the element with the handler (targetValue
  ;; reads ctx.node, not event.target)
  (evt ::= (event fname addr value))
  (obs ::= (log value) (failed fname) rendered)
  (outcome ::= (ok value (tsk ...) (tsk ...) (obs ...)) (failed (obs ...)))
  (cfg ::= (host registry (ask-def ...) value (tsk ...) (tsk ...)
                 (ldom ...) (node ...) value (evt ...) (obs ...) lbl)))

;; Send arguments, against the message context.
(define-metafunction Tasks
  eval-arg : arg value any -> value
  [(eval-arg (target-value) value_tv any) value_tv]
  [(eval-arg (source-key) value_tv any) any]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any) (eval-arg arg_t value_tv any)
   (side-condition (truthy? (term (eval-arg arg_c value_tv any))))]
  [(eval-arg (if arg_c arg_t arg_e) value_tv any) (eval-arg arg_e value_tv any)]
  [(eval-arg value value_tv any) value])

;; ---- message handlers ------------------------------------------------------
;; The command interpreter: a handler runs with `next`, `self`, `sourceKey`
;; and its parameters bound. It yields the new leaf, the tasks it sent (with no
;; route yet), whether it called stopNext, and the async replies it started.

(struct mctx (path source-key task obs) #:transparent)

(define (emit! ctx o) (set-box! (mctx-obs ctx) (cons o (unbox (mctx-obs ctx)))))

(define (set-path v keys x)
  (if (null? keys) x
      (term (prop-set ,v ,(car keys) ,(set-path (term (prop-get ,v ,(car keys))) (cdr keys) x)))))

(define (child-task ctx kind name args base sel)
  `(task ,kind ,name ,args ,(mctx-path ctx) (at ,base ,sel) none))

;; Runs cmds; returns (list leaf tasks stop?) where leaf is the final next or
;; the replacement a `replace` returned.
(define (exec cmds env ctx self next tasks stop)
  (define (ev hx) (term (eval-hx (env-extend ,env (next ,next)) ,hx)))
  (match cmds
    ['() (list next tasks stop)]
    [(cons cmd more)
     (define (continue next tasks stop) (exec more env ctx self next tasks stop))
     (match cmd
       [`(set ,lvs ,hx)
        (define keys (for/list ([lv lvs]) (match lv [`(at ,k) (ev k)] [f f])))
        (continue (set-path next keys (ev hx)) tasks stop)]
       [`(replace ,hx) (list (ev hx) tasks stop)]
       [`(notify ,name ,hxs ...)
        (define path (mctx-path ctx))
        (continue next
                  (if (null? path) tasks
                      (append tasks (list (child-task ctx 'notify name (map ev hxs) (term (to-parent-path ,path)) '()))))
                  stop)]
       [`(ask ,name ,hxs ...)
        (continue next (append tasks (list (child-task ctx 'ask name (map ev hxs) (mctx-path ctx) '()))) stop)]
       [`(send-at ,name ,hxs ,sel)
        (continue next (append tasks (list (child-task ctx 'plain name (map ev hxs) (mctx-path ctx) sel))) stop)]
       [`(forward-at ,sel)
        (match-define `(task ,_ ,name ,args ,_ ,_ ,_) (mctx-task ctx))
        (continue next (append tasks (list (child-task ctx 'plain name args (mctx-path ctx) sel))) stop)]
       ['(stop-next) (continue next tasks #t)]
       [`(log ,hx) (emit! ctx `(log ,(ev hx))) (continue next tasks stop)]
       [`(fail ,hx) (error 'handler "~a" (ev hx))]
       [`(when ,hx ,body ...)
        (if (truthy? (ev hx))
            (match-let ([(list next tasks stop) (exec body env ctx self next tasks stop)])
              (continue next tasks stop))
            (continue next tasks stop))])]))

(define (find-handler reg instance name)
  (lookup-named (class-section (term (class-def-of ,reg ,instance)) 'on) name))

;; call(): run a found handler with its arguments.
(define (call handler instance args ctx)
  (match-define `(,_ (,params ...) ,cmds ...) handler)
  (define env (append `((self ,instance) (sourceKey ,(mctx-source-key ctx)))
                      (for/list ([p params] [i (in-naturals)])
                        (list p (if (< i (length args)) (list-ref args i) 'null)))))
  (exec cmds env ctx instance instance '() #f))

;; run(): a missing handler warns and keeps next.
(define (run reg instance name args ctx)
  (define handler (find-handler reg instance name))
  (if handler (call handler instance args ctx) (list instance '() #f)))

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
     (define handler (find-handler reg instance name))
     (unless handler (error 'event "no handler ~a" name)) ; lint guarantees it exists
     ;; EventTask.run sets this.args before the handler runs, so forwardAt sends them.
     (match-define `(task ,k ,n ,_ ,rest ...) task)
     (define ctx/args (struct-copy mctx ctx [task `(task ,k ,n ,args ,@rest)]))
     (append (call handler instance args ctx/args) '(()))]))

;; prepareTask: a task without a route freezes its selector against the value
;; its base resolves to in the root; the frozen frames extend the base.
(define (prepare root task)
  (match task
    [`(task ,kind ,name ,args ,source (at ,base ,sel) none)
     (define start (term (get-in (resolve ,base) ,root)))
     (define dispatch (append base (term (freeze-sel ,sel ,start))))
     `(task ,kind ,name ,args ,source (at ,base ,sel) ,(term (route-for ,dispatch)))]
    [_ task]))

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
        (define ctx (mctx cpath (term (source-key-in ,source ,cpath)) (term tsk) obs))
        (match-define (list leaf tasks _ replies)
          (run-kind (term registry) (term (ask-def ...)) instance (term tsk) ctx))
        (define new-root (term (set-in ,update-path ,root ,leaf)))
        (define children (for/list ([t tasks]) (prepare new-root t)))
        `(ok ,new-root ,children ,replies ,(reverse (unbox obs)))))])

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

(define host->
  (reduction-relation
   Tasks #:domain cfg
   ;; handleEvent: route against the current DOM and root; the route is fixed now.
   (--> (host registry any_a value (tsk ...) any_p (ldom ...) any_v any_r
              (evt_0 evt ...) any_o lbl)
        (host registry any_a value (tsk ... tsk_e ...) any_p (ldom ...) any_v any_r
              (evt ...) any_o lbl)
        (where (tsk_e ...) (route-event registry value (ldom ...) evt_0))
        event)
   ;; A committed transaction: the new root, then its children, in order.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) (tsk_p ...) any_d any_v any_r
              any_e (obs ...) lbl)
        (host registry (ask-def ...) value_new (tsk ... tsk_c ...) (tsk_p ... tsk_r ...) any_d any_v any_r
              any_e (obs ... obs_new ...) lbl)
        (where (ok value_new (tsk_c ...) (tsk_r ...) (obs_new ...))
               (handle-task registry (ask-def ...) value tsk_0))
        run)
   ;; An aborted transaction: nothing but its observations survives.
   (--> (host registry (ask-def ...) value (tsk_0 tsk ...) any_p any_d any_v any_r
              any_e (obs ...) lbl)
        (host registry (ask-def ...) value (tsk ...) any_p any_d any_v any_r
              any_e (obs ... obs_new ... (failed (task-name tsk_0))) lbl)
        (where (failed (obs_new ...)) (handle-task registry (ask-def ...) value tsk_0))
        fail)
   ;; A pending async ask settles, in any order: its reply joins the queue.
   (--> (host registry any_a value (tsk ...) (tsk_1 ... tsk_r tsk_2 ...) any_d any_v any_r
              any_e any_o lbl)
        (host registry any_a value (tsk ... tsk_r) (tsk_1 ... tsk_2 ...) any_d any_v any_r
              any_e any_o lbl)
        resolve)
   ;; Host.render: morph the DOM from the last vnodes to the root's.
   (--> (host registry any_a value any_q any_p (ldom ...) (node_old ...) value_r
              any_e (obs ...) lbl)
        (host registry any_a value any_q any_p (ldom_new ...) (node_new ...) value
              any_e (obs ... rendered) lbl_new)
        (side-condition (not (equal? (term value) (term value_r))))
        (where (node_new ...) (render-root registry value))
        (where ((ldom_new ...) lbl_new)
               (morph-children (ldom ...) (node_old ...) (node_new ...) ,HTML-NS lbl))
        render)))

;; Host.start: register the classes and mount the root's first render.
(define (start classes root #:asks [asks '()] #:events [events '()])
  (define reg (term (register-classes ,classes)))
  (define vdom (term (render-root ,reg ,root)))
  (match-define (list doms next) (term (mount-all ,vdom ,HTML-NS 0)))
  `(host ,reg ,asks ,root () () ,doms ,vdom ,root ,events () ,next))

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

;; Run the queue empty, then render if the root changed (handleTasks).
(define (drain c)
  (cond [(pair? (cfg-queue c)) (drain (or (step-by 'run c) (step-by 'fail c)))]
        [(step-by 'render c) => values]
        [else c]))

(define (resolve-ask c) (step-by 'resolve c))

(module+ test
  (require rackunit)
  (define counter
    (term ((class Counter
             (views ("main" (h 1 "button" ((on click (send inc (target-value)))) (field n))))
             (on (inc (by) (set (n) (+ (get next n) by)) (log (get next n))))))))
  (define c0 (start counter '(comp Counter (n 0)) #:events '((event click (1) 2))))

  ;; An event routes to the button's handler; the task commits; render morphs
  ;; the same button node.
  (define c1 (drain (deliver c0)))
  (test-equal (cfg-root c1) '(comp Counter (n 2)))
  (test-equal (logs c1) '(2))
  (test-equal (term (erase-all ,(cfg-dom c1)))
              (term (render (render-root ,(second c1) (comp Counter (n 2))))))
  (test-equal (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c1)))
              (map second (filter (λ (d) (eq? (first d) 'element)) (cfg-dom c0))))

  ;; Events that hit nothing are dropped.
  (test-equal (cfg-queue (deliver (start counter '(comp Counter (n 0)) #:events '((event input (1) 0)))))
              '())

  ;; A failing handler aborts its transaction: the root stays and the children
  ;; it sent are discarded, but its logs, like any JS side effect, remain.
  (define failing
    (term ((class Root
             (views ("main" "x"))
             (on (go () (set (n) 1) (log "before") (send-at go () ()) (fail "boom")))))))
  (define cf (drain `(host ,(term (register-classes ,failing)) () (comp Root (n 0))
                           ((task plain go () () (at () ()) (() ()))) () () () (comp Root (n 0)) () () 0)))
  (test-equal (cfg-root cf) '(comp Root (n 0)))
  (test-equal (cfg-obs cf) '((log "before") (failed go)))
  (test-equal (cfg-queue cf) '())
  (test-results))
