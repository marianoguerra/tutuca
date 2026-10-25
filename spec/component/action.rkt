#lang racket
;; Actions: what handling one message does to one instance (MessageSpec.run),
;; and the checks of schema.js: message contracts (messageIssues) and invalid
;; state (findInvalidFields).
;;
;; act reads only its inputs: the class, the instance (self), the message's
;; name and arguments, and the source key. It yields the next instance and the
;; effects, already evaluated, which the host turns into tasks and
;; observations. A handler that throws yields `aborted` with the effects
;; evaluated before the throw: their logs, like any JS side effect, survive.
(require redex/reduction-semantics "../data.rkt" "paths.rkt" "expr.rkt" "types.rkt" "class.rkt")
(provide Action act message-issues invalid-in)

(define-extended-language Action Class
  ;; Effects with their arguments evaluated. Selectors stay as they are: they
  ;; freeze at commit, against the new root.
  (fx ::= (notify fname value ...) (ask fname value ...)
          (send-at fname (value ...) sel) (forward-at sel) (stop) (log value))
  (stepped ::= (ok value (fx ...)) (aborted (fx ...)))
  (issue ::= string))

(define (ev env hx) (term (eval-hx ,env ,hx)))

(define (holds? env hx)
  (with-handlers ([exn:fail? (λ (_) #f)]) (truthy? (ev env hx))))

(define (set-path v keys x)
  (if (null? keys) x
      (term (prop-set ,v ,(car keys) ,(set-path (term (prop-get ,v ,(car keys))) (cdr keys) x)))))

;; The env a handler's expressions see: self, sourceKey and its parameters,
;; missing arguments reading as null.
(define (handler-env handler self args sk)
  (match-define `(,_ (,params ...) ,_ ...) handler)
  (append `((self ,self) (sourceKey ,sk))
          (for/list ([p params] [i (in-naturals)])
            (list p (if (< i (length args)) (list-ref args i) 'null)))))

(define (body-of handler) (last handler))

;; The first enabled case; #f when none is.
(define (enabled-step env body)
  (match body
    [`(step ,_ ...) body]
    [`(cases (,guards ,bodies) ...)
     (for/or ([g guards] [b bodies])
       (and (truthy? (ev env g)) (enabled-step env b)))]))

;; Run one step: the updates over self (or its replacement), all read against
;; self; then the effects, in order, seeing next.
(define (run-step env self parts)
  (define base (or (for/last ([p parts] #:when (eq? (first p) 'become)) (ev env (second p))) self))
  (define next
    (for/fold ([next base]) ([p parts] #:when (eq? (first p) 'next))
      (match-define `(next (,lvs ...) ,hx) p)
      (define keys (for/list ([lv lvs]) (match lv [`(at ,k) (ev env k)] [f f])))
      (set-path next keys (ev env hx))))
  (define env/next (term (env-extend ,env (next ,next))))
  (let loop ([parts (filter (λ (p) (not (memq (first p) '(next become)))) parts)] [done '()])
    (define (abort) `(aborted ,(reverse done)))
    (match parts
      ['() `(ok ,next ,(reverse done))]
      [(cons eff more)
       (define fx
         (with-handlers ([exn:fail? (λ (_) #f)])
           (match eff
             [`(fail ,hx) (ev env/next hx) #f]
             [`(notify ,n ,hxs ...) `(notify ,n ,@(for/list ([h hxs]) (ev env/next h)))]
             [`(ask ,n ,hxs ...) `(ask ,n ,@(for/list ([h hxs]) (ev env/next h)))]
             [`(send-at ,n (,hxs ...) ,sel) `(send-at ,n ,(for/list ([h hxs]) (ev env/next h)) ,sel)]
             [`(forward-at ,sel) eff]
             ['(stop) eff]
             [`(log ,hx) `(log ,(ev env/next hx))])))
       (if fx (loop more (cons fx done)) (abort))])))

;; One message on one instance. The handler must exist; the host decides what
;; a missing handler means.
(define-metafunction Action
  act : class-def value fname (value ...) value -> stepped
  [(act class-def value_self fname (value ...) value_sk)
   ,(let* ([handler (handler-of (term class-def) (term fname))]
           [env (handler-env handler (term value_self) (term (value ...)) (term value_sk))])
      (match (with-handlers ([exn:fail? (λ (_) #f)]) (enabled-step env (body-of handler)))
        [#f '(aborted ())]
        [(list _ parts ...)
         (with-handlers ([exn:fail? (λ (_) '(aborted ()))])
           (run-step env (term value_self) parts))]))
   (side-condition (handler-of (term class-def) (term fname)))])

;; messageIssues: the ways a handled message broke its contract. emitted lists
;; what the handler sent, as (kind name); forwardAt counts as a send-at.
(define-metafunction Action
  message-issues : class-def fname value value (value ...) value ((emit-kind fname) ...) -> (issue ...)
  [(message-issues class-def fname value_prev value_next (value ...) value_sk ((emit-kind fname_e) ...))
   ,(let* ([handler (handler-of (term class-def) (term fname))]
           [args (term (value ...))]
           [prev (term value_prev)]
           [env (handler-env handler prev args (term value_sk))]
           [c (λ (kind) (contract-of handler kind))])
      (append
       (match (c 'args)
         [#f '()]
         [types #:when (not (= (length types) (length args))) '("args")]
         [types (for/list ([t types] [a args] [i (in-naturals)] #:unless (valid? t a prev))
                  (format "arg:~a" i))])
       (match (c 'source-key)
         [(list t) #:when (not (valid? t (term value_sk) prev)) '("sourceKey")]
         [_ '()])
       (match (c 'pre) [(list hx) #:when (not (holds? env hx)) '("pre")] [_ '()])
       (match (c 'post)
         [(list hx) #:when (not (holds? (term (env-extend ,env (next value_next))) hx)) '("post")]
         [_ '()])
       (match (c 'emits)
         [#f '()]
         [declared
          (for/list ([k (term (emit-kind ...))] [n (term (fname_e ...))]
                     #:unless (memq n (rest (or (assq k declared) '(_)))))
            (format "emits:~a:~a" k n))])))])

;; findInvalidFields: the fields of the components in value that do not match
;; their schema, as (path class field value reason), then broken invariants,
;; reported on the component with field null. Subtrees equal to prev are
;; skipped, so after a task only what it changed is walked. check is the set of
;; checks to report: fields, invariants or both. A class without a fields
;; section has no schema to check.
(define-metafunction Action
  invalid-in : (class-def ...) value value (any ...) -> (any ...)
  [(invalid-in (class-def ...) value_new value_prev (any ...))
   ,(collect (term (class-def ...)) (term value_new) (term value_prev) (term (any ...)) '())])

(define (collect defs value prev check path)
  (define (prev-at k) (with-handlers ([exn:fail? (λ (_) 'null)]) (term (prop-get ,prev ,k))))
  (define (key f) (symbol->string f))
  (match value
    [_ #:when (equal? value prev) '()]
    [(list 'arr vs ...)
     (append* (for/list ([v vs] [i (in-naturals)]) (collect defs v (prev-at i) check (append path (list i)))))]
    [(list 'rec (list fs vs) ...)
     (append* (for/list ([f fs] [v vs]) (collect defs v (prev-at f) check (append path (list (key f))))))]
    [(list 'comp cname (list fs vs) ...)
     (define def (for/first ([d defs] #:when (eq? (def-name d) cname)) d))
     (define schema (and def (class-fields def)))
     (define fields? (memq 'fields check))
     (define own (map list fs vs))
     (append
      (if (and schema fields?)
          (for/list ([f fs] [v vs] #:unless (assq f schema))
            (list (append path (list (key f))) cname f v "undeclared"))
          '())
      (append*
       (for/list ([entry (or schema own)])
         (match-define (list f ty) (if schema entry (list (first entry) 'Any)))
         (define present (assq f own))
         (define v (if present (second present) 'null))
         (append
          (if (and schema fields? (not (and present (valid? ty v value))))
              (list (list (append path (list (key f))) cname f v "invalid"))
              '())
          (collect defs v (prev-at f) check (append path (list (key f)))))))
      (if (and def (memq 'invariants check))
          (for/list ([inv (def-section def 'invariants)]
                     #:unless (holds? `((self ,value)) (second inv)))
            (list path cname 'null value (format "invariant:~a" (first inv))))
          '()))]
    [_ '()]))

(module+ test
  (require rackunit)
  (define counter
    (term (class Counter
            (fields (n (Refine Number int)) (log (Array Any)))
            (invariants (small (< (get self n) 10)))
            (on (inc (by)
                     (args (Refine Number (min 0)))
                     (pre (< by 5))
                     (post (= (get next n) (+ (get self n) by)))
                     (emits (notify changed))
                     (step (next (n) (+ (get self n) by)) (notify changed (get next n)) (log (get next n))))
                (reset () (cases ((< 0 (get self n)) (step (next (n) 0)))))
                (swap () (step (become (comp Counter (n 1) (log (arr)))) (next (n) 2)))
                (bad () (step (log "before") (fail "boom") (log "after")))
                (pick (k) (step (next (log (at k)) sourceKey)))))))
  (define c0 '(comp Counter (n 1) (log (arr "x"))))

  ;; Updates read self; effects see next, in order.
  (test-equal (term (act ,counter ,c0 inc (2) null))
              '(ok (comp Counter (n 3) (log (arr "x"))) ((notify changed 3) (log 3))))
  ;; Missing arguments read as null: + null throws, and nothing was emitted yet.
  (test-equal (term (act ,counter ,c0 inc () null)) '(aborted ()))
  ;; The first enabled case runs; with none, the handler has no step.
  (test-equal (term (act ,counter ,c0 reset () null)) '(ok (comp Counter (n 0) (log (arr "x"))) ()))
  (test-equal (term (act ,counter (comp Counter (n 0) (log (arr))) reset () null)) '(aborted ()))
  ;; become replaces the instance; updates then apply to the replacement.
  (test-equal (term (act ,counter ,c0 swap () null)) '(ok (comp Counter (n 2) (log (arr))) ()))
  ;; fail aborts; effects before it survive.
  (test-equal (term (act ,counter ,c0 bad () null)) '(aborted ((log "before"))))
  ;; Paths with computed keys, and sourceKey.
  (test-equal (term (act ,counter ,c0 pick (0) "k")) '(ok (comp Counter (n 1) (log (arr "k"))) ()))
  ;; A handler that does not exist has no step.
  (check-exn exn:fail? (λ () (term (act ,counter ,c0 nope () null))))

  ;; Contracts.
  (define (issues name prev next args emitted)
    (term (message-issues ,counter ,name ,prev ,next ,args null ,emitted)))
  (define c3 '(comp Counter (n 3) (log (arr "x"))))
  (test-equal (issues 'inc c0 c3 '(2) '((notify changed))) '())
  (test-equal (issues 'inc c0 c3 '(2 1) '()) '("args"))
  (test-equal (issues 'inc c0 c0 '(-1) '((ask load) (notify changed)))
              '("arg:0" "post" "emits:ask:load"))
  (test-equal (issues 'inc c0 c3 '(7) '()) '("pre" "post"))
  ;; A handler without a contract has no issues.
  (test-equal (issues 'reset c0 c0 '(9) '((ask x))) '())

  ;; Invalid state: undeclared and invalid fields, then broken invariants;
  ;; unchanged subtrees are skipped.
  (define root '(rec (a (comp Counter (n 1.5) (log (arr)) (extra 1)))
                     (b (comp Counter (n 12) (log (arr))))))
  (test-equal (term (invalid-in (,counter) ,root null (fields invariants)))
              '((("a" "extra") Counter extra 1 "undeclared")
                (("a" "n") Counter n 1.5 "invalid")
                (("b") Counter null (comp Counter (n 12) (log (arr))) "invariant:small")))
  (test-equal (term (invalid-in (,counter) ,root null (invariants)))
              '((("b") Counter null (comp Counter (n 12) (log (arr))) "invariant:small")))
  (test-equal (term (invalid-in (,counter) ,root ,root (fields invariants))) '())
  ;; A declared field that is missing is invalid.
  (test-equal (term (invalid-in (,counter) (comp Counter (n 1)) null (fields)))
              '((("log") Counter log null "invalid")))
  ;; Classes without a schema are walked, not checked.
  (test-equal (term (invalid-in (,counter) (comp Other (x (comp Counter (n 1) (log (arr)) (y 0)))) null (fields)))
              '((("x" "y") Counter y 0 "undeclared")))

  ;; Refinement, as pbt.js checks it: from any valid instance and valid
  ;; arguments that meet pre, the handler's step meets post and emits, and
  ;; leaves the fields valid. A handler that breaks its contract is caught.
  (define (bounded body)
    (term (class Bounded
            (fields (n (Refine Number int (min 0) (max 10))))
            (on (add (by)
                     (args (Refine Number int (min 0)))
                     (pre (not (< 10 (+ (get self n) by))))
                     (post (= (get next n) (+ (get self n) by)))
                     (emits (notify changed))
                     ,body)))))
  (define (refines? def)
    (redex-check Action (natural_n natural_by)
                 (let ([self `(comp Bounded (n ,(term natural_n)))] [args (list (term natural_by))])
                   (or (> (+ (term natural_n) (term natural_by)) 10)  ; pre does not hold
                       (match (term (act ,def ,self add ,args null))
                         [`(ok ,next ,fxs)
                          (and (null? (term (message-issues ,def add ,self ,next ,args null
                                                            ,(for/list ([f fxs] #:when (eq? (first f) 'notify))
                                                               (list 'notify (second f))))))
                               (null? (term (invalid-in (,def) ,next ,self (fields)))))]
                         [_ #f])))
                 #:attempts 300 #:print? #f))
  (test-equal (refines? (bounded '(step (next (n) (+ (get self n) by)) (notify changed)))) #t)
  (test-equal (counterexample? (refines? (bounded '(step (next (n) (+ (get self n) (+ by by))))))) #t)
  (test-results))
