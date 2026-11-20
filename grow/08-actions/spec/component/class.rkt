#lang racket
;; Classes: the model half of component(). A class says what state its
;; instances hold and which messages they handle.
;;
;; Instances are values, not objects: there is no identity and no inheritance.
;;
;; Each message handler is an action, in the style of TLA+: a guarded step from
;; the instance before the message (self) to the instance after it (next),
;; together with the effects it emits. Handlers are deterministic: the first
;; enabled case runs, and a message with no enabled case has no step, which is
;; how the model says the handler threw.
(require redex/reduction-semantics "../data.rkt" "expr.rkt" "types.rkt")
(provide Class class-fields make-instance handler-of)

(define-extended-language Class Types
  (class-def ::= (class cname csection ...))
  (csection ::= (fields (fname ty) ...)     ; the schema; without it, fields are not checked
                (on handler ...))
  ;; A message: its parameters, then its body.
  (handler ::= (fname (x ...) body))
  ;; A body is one step, or cases: the first truthy guard's body runs.
  (body ::= (step part ...) (cases (hx body) ...))
  ;; A step's parts: next.a.b = v, a replacement for the whole instance, and
  ;; effects. Updates read self, never next; effects run in order and may read
  ;; next. A field no update names keeps its value (UNCHANGED).
  (part ::= (next (lv ...) hx) (become hx) eff)
  (lv ::= fname (at hx))
  (eff ::= (log hx)                       ; an observable side effect
           (fail hx)))                    ; throw

(define (handler-of def name) (lookup-named (def-section def 'on) name))

;; The schema, or #f when the class has no fields section.
(define (class-fields def)
  (match def
    [(list 'class _ sections ...)
     (for/first ([s sections] #:when (eq? (first s) 'fields)) (rest s))]))

;; make: an instance from arguments by field name. Each field is made in the
;; order the class declares it, and its owner is the instance so far, so a
;; field can read the ones before it.
(define-metafunction Class
  make-instance : class-def (fname value) ... -> value
  [(make-instance class-def (fname value) ...)
   ,(for/fold ([self (term (comp ,(def-name (term class-def))))])
              ([f (or (class-fields (term class-def)) '())])
      (match-define (list name ty) f)
      (define arg (match (assq name (term ((fname value) ...))) [(list _ v) v] [#f 'absent]))
      (term (prop-set ,self ,name (make-field ,ty ,arg ,self))))])

(module+ test
  (require rackunit)
  (define counter (term (class Counter (fields (n (Refine Number int)) (label (Default String "count"))))))
  (test-equal (redex-match? Class class-def counter) #t)
  (test-equal (class-fields counter) '((n (Refine Number int)) (label (Default String "count"))))
  (test-equal (class-fields '(class C)) #f)

  ;; Fields get their arguments, or their defaults.
  (test-equal (term (make-instance ,counter)) '(comp Counter (n 0) (label "count")))
  (test-equal (term (make-instance ,counter (n 3))) '(comp Counter (n 3) (label "count")))
  ;; An argument that is not valid gives the default; one for no field is dropped.
  (test-equal (term (make-instance ,counter (n 1.5) (other 1))) '(comp Counter (n 0) (label "count")))
  (test-equal (term (comp-class (make-instance ,counter))) 'Counter)

  ;; A field can read the fields before it.
  (define tabs (term (class Tabs (fields (items (Default (Array String) (arr "a" "b"))) (selected (Index items))))))
  (test-equal (term (make-instance ,tabs)) '(comp Tabs (items (arr "a" "b")) (selected 0)))
  (test-equal (term (make-instance ,tabs (selected 1))) '(comp Tabs (items (arr "a" "b")) (selected 1)))
  (test-equal (term (make-instance ,tabs (selected 5))) '(comp Tabs (items (arr "a" "b")) (selected 0)))
  (define stepper
    (term (class Counter
            (fields (n Number))
            (on (inc (by) (step (next (n) (+ (get self n) by))))
                (reset () (cases ((< 0 (get self n)) (step (next (n) 0)))))))))
  (test-equal (redex-match? Class class-def stepper) #t)
  (test-equal (first (handler-of stepper 'inc)) 'inc)
  (test-equal (handler-of stepper 'nope) #f)
  (test-equal (redex-match? Class handler (term (go () (step (fail "no"))))) #t)
  ;; A field with no default is required.
  (check-exn exn:fail? (λ () (term (make-instance ,tabs (items (arr))))))
  (test-results))
