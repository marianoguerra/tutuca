#lang racket
;; Classes: the model half of component() (fields, invariants and on), with no
;; views. A class says what state its instances hold and which messages they
;; handle; view/view.rkt pairs it with the views that render it.
;;
;; Instances are values, not objects: there is no identity and no inheritance.
;; Where an instance lives (its route) is the only identity it has.
;;
;; Each message handler is an action, in the style of TLA+: a guarded step from
;; the instance before the message (self) to the instance after it (next),
;; together with the effects it emits. Handlers are deterministic: the first
;; enabled case runs, and a message with no enabled case has no step, which is
;; how the model says the handler threw. All nondeterminism is in the host
;; (system/host.rkt): when events arrive, the order replies settle in, and when
;; renders happen.
(require redex/reduction-semantics "expr.rkt" "types.rkt")
(provide Class handler-of contract-of class-fields)

(define-extended-language Class Types
  (class-def ::= (class cname csection ...))
  (csection ::= (fields (fname ty) ...)     ; the schema; without it, fields are not checked
                (invariants (fname hx) ...) ; predicates on self, checked when the queue is empty
                (on handler ...))
  ;; A message: its parameters, its contract, then its body.
  (handler ::= (fname (x ...) contract ... body))
  ;; MessageSpec: the types of the arguments and of the source key, a
  ;; precondition on self and the arguments, a postcondition relating self and
  ;; next, and the messages the handler may emit.
  (contract ::= (args ty ...) (source-key ty) (pre hx) (post hx) (emits (emit-kind fname ...) ...))
  (emit-kind ::= notify ask send-at)
  ;; A body is one step, or cases: the first truthy guard's body runs.
  (body ::= (step part ...) (cases (hx body) ...))
  ;; A step's parts: next.a.b = v, a replacement for the whole instance, and
  ;; effects. Updates read self, never next; effects run in order and may read
  ;; next. A field no update names keeps its value (UNCHANGED).
  (part ::= (next (lv ...) hx) (become hx) eff)
  (lv ::= fname (at hx))
  (eff ::= (notify fname hx ...) (ask fname hx ...)
           (send-at fname (hx ...) sel) (forward-at sel)
           (stop)                         ; stopNext: a notify stops bubbling here
           (log hx)                       ; an observable side effect
           (fail hx)))                    ; throw

(define (handler-of def name) (lookup-named (def-section def 'on) name))

;; The handler's contract entries, by kind; #f for each one it does not give.
(define (contract-of handler kind)
  (match handler
    [(list _ _ parts ...)
     (for/first ([p parts] #:when (and (pair? p) (eq? (first p) kind))) (rest p))]))

;; The schema, or #f when the class has no fields section.
(define (class-fields def)
  (match def
    [(list 'class _ sections ...)
     (for/first ([s sections] #:when (eq? (first s) 'fields)) (rest s))]))

(module+ test
  (require rackunit)
  (define counter
    (term (class Counter
            (fields (n (Refine Number int)))
            (invariants (positive (not (< (get self n) 0))))
            (on (inc (by)
                     (args (Refine Number (min 0)))
                     (post (= (get next n) (+ (get self n) by)))
                     (emits (notify changed))
                     (step (next (n) (+ (get self n) by)) (notify changed)))
                (reset () (cases ((< 0 (get self n)) (step (next (n) 0)))))))))
  (test-equal (redex-match? Class class-def counter) #t)
  (test-equal (first (handler-of counter 'inc)) 'inc)
  (test-equal (contract-of (handler-of counter 'inc) 'args) '((Refine Number (min 0))))
  (test-equal (contract-of (handler-of counter 'inc) 'pre) #f)
  (test-equal (class-fields counter) '((n (Refine Number int))))
  (test-equal (class-fields '(class C (on))) #f)
  (test-equal (redex-match? Class handler (term (go () (step (fail "no"))))) #t)
  (test-results))
