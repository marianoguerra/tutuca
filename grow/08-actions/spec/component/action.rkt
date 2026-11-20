#lang racket
;; Actions: what handling one message does to one instance.
;;
;; act reads only its inputs: the class, the instance (self), and the
;; message's name and arguments. It yields the next instance and the effects,
;; already evaluated. A handler that throws yields `aborted` with the effects
;; evaluated before the throw: their logs, like any JS side effect, survive.
(require redex/reduction-semantics "../data.rkt" "paths.rkt" "expr.rkt" "types.rkt" "class.rkt")
(provide Action act)

(define-extended-language Action Class
  ;; Effects with their arguments evaluated.
  (fx ::= (log value))
  (stepped ::= (ok value (fx ...)) (aborted (fx ...))))

(define (ev env hx) (term (eval-hx ,env ,hx)))

(define (set-path v keys x)
  (if (null? keys) x
      (term (prop-set ,v ,(car keys) ,(set-path (term (prop-get ,v ,(car keys))) (cdr keys) x)))))

;; The env a handler's expressions see: self and its parameters, missing
;; arguments reading as null.
(define (handler-env handler self args)
  (match-define `(,_ (,params ...) ,_ ...) handler)
  (append `((self ,self))
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
             [`(log ,hx) `(log ,(ev env/next hx))])))
       (if fx (loop more (cons fx done)) (abort))])))

;; One message on one instance. The handler must exist; the host decides what
;; a missing handler means.
(define-metafunction Action
  act : class-def value fname (value ...) -> stepped
  [(act class-def value_self fname (value ...))
   ,(let* ([handler (handler-of (term class-def) (term fname))]
           [env (handler-env handler (term value_self) (term (value ...)))])
      (match (with-handlers ([exn:fail? (λ (_) #f)]) (enabled-step env (body-of handler)))
        [#f '(aborted ())]
        [(list _ parts ...)
         (with-handlers ([exn:fail? (λ (_) '(aborted ()))])
           (run-step env (term value_self) parts))]))
   (side-condition (handler-of (term class-def) (term fname)))])

(module+ test
  (require rackunit)
  (define counter
    (term (class Counter
            (fields (n (Refine Number int)) (log (Array Any)))
            (on (inc (by) (step (next (n) (+ (get self n) by)) (log (get next n))))
                (twice () (step (next (n) (+ (get self n) 1)) (next (n) (+ (get self n) 1))))
                (reset () (cases ((< 0 (get self n)) (step (next (n) 0)))))
                (swap () (step (become (comp Counter (n 1) (log (arr)))) (next (n) 2)))
                (bad () (step (log "before") (fail "boom") (log "after")))
                (pick (k v) (step (next (log (at k)) v)))))))
  (define c0 '(comp Counter (n 1) (log (arr "x"))))

  ;; Effects see next, in order.
  (test-equal (term (act ,counter ,c0 inc (2)))
              '(ok (comp Counter (n 3) (log (arr "x"))) ((log 3))))
  ;; Updates read self, never next.
  (test-equal (term (act ,counter ,c0 twice ())) '(ok (comp Counter (n 2) (log (arr "x"))) ()))
  ;; Missing arguments read as null: + null throws, and nothing was emitted yet.
  (test-equal (term (act ,counter ,c0 inc ())) '(aborted ()))
  ;; The first enabled case runs; with none, the handler has no step.
  (test-equal (term (act ,counter ,c0 reset ())) '(ok (comp Counter (n 0) (log (arr "x"))) ()))
  (test-equal (term (act ,counter (comp Counter (n 0) (log (arr))) reset ())) '(aborted ()))
  ;; become replaces the instance; updates then apply to the replacement.
  (test-equal (term (act ,counter ,c0 swap ())) '(ok (comp Counter (n 2) (log (arr))) ()))
  ;; fail aborts; effects before it survive.
  (test-equal (term (act ,counter ,c0 bad ())) '(aborted ((log "before"))))
  ;; Paths with computed keys.
  (test-equal (term (act ,counter ,c0 pick (0 "k"))) '(ok (comp Counter (n 1) (log (arr "k"))) ()))
  ;; A handler that does not exist has no step.
  (check-exn exn:fail? (λ () (term (act ,counter ,c0 nope ()))))
  (test-results))
