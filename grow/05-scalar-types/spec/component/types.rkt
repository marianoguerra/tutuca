#lang racket
;; Field types: the t.* builders, what values they accept, and how a field is
;; made from an argument or its default.
;;
;; A type is a term. Refine adds the constraints of int(), min(), max(), len()
;; and where(); Default is .default(v). An owner is the value holding the field.
(require redex/reduction-semantics "../data.rkt" "expr.rkt")
(provide Types valid valid? default-of make-field meets? type-length)

(define-extended-language Types Expr
  (ty ::= Any String Number Boolean
          (Refine ty check ...) (Default ty value))
  (check ::= int (min number) (max number) (len natural) (len natural natural) (pred x hx))
  (owner ::= value none)
  (arg? ::= value absent))                 ; a make argument, or undefined

;; lengthOf: string length.
(define (type-length v)
  (match v
    [(? string?) (string-length v)]
    [_ #f]))

;; One constraint; a constraint of the wrong kind, like min on a string, does
;; not hold (the runtime's comparison is false or throws).
(define (check-holds? c v)
  (with-handlers ([exn:fail? (λ (_) #f)])
    (match c
      ['int (and (real? v) (integer? v))]
      [(list 'min m) (and (real? v) (>= v m))]
      [(list 'max m) (and (real? v) (<= v m))]
      [(list 'len lo) (>= (type-length v) lo)]
      [(list 'len lo hi) (<= lo (type-length v) hi)]
      [(list 'pred x hx) (truthy? (term (eval-hx ((,x ,v)) ,hx)))])))

(define (finite-number? v) (and (real? v) (not (nan? v)) (not (infinite? v))))

;; isValid: the value has the type's kind and meets its constraints.
(define-judgment-form Types
  #:mode (valid I I I)
  #:contract (valid ty value owner)
  [----------------------- "any"
   (valid Any value owner)]
  [(side-condition ,(string? (term value)))
   ----------------------- "string"
   (valid String value owner)]
  [(side-condition ,(finite-number? (term value)))
   ----------------------- "number"
   (valid Number value owner)]
  [(side-condition ,(boolean? (term value)))
   ----------------------- "boolean"
   (valid Boolean value owner)]
  [(valid ty value owner)
   (side-condition ,(andmap (λ (c) (check-holds? c (term value))) (term (check ...))))
   ----------------------- "refine"
   (valid (Refine ty check ...) value owner)]
  [(valid ty value owner)
   ----------------------- "default"
   (valid (Default ty value_d) value owner)])

(define (valid? ty v owner) (judgment-holds (valid ,ty ,v ,owner)))

;; makeDefault: the value an absent argument becomes. Bounds pull Number's zero
;; default in.
(define-metafunction Types
  default-of : ty owner -> value
  [(default-of Any owner) null]
  [(default-of String owner) ""]
  [(default-of Number owner) 0]
  [(default-of Boolean owner) #f]
  [(default-of (Refine Number check ...) owner) ,(clamp 0 (term (check ...)))]
  [(default-of (Refine ty check ...) owner) (default-of ty owner)]
  [(default-of (Default ty value) owner) value])

(define (clamp v checks)
  (for/fold ([v v]) ([c checks])
    (match c
      [(list 'min m) (if (< v m) m v)]
      [(list 'max m) (if (> v m) m v)]
      [_ v])))

;; meetsConstraints: only the type's own constraints, not its kind.
(define-metafunction Types
  meets? : ty value -> boolean
  [(meets? (Refine ty check ...) value)
   ,(and (term (meets? ty value)) (andmap (λ (c) (check-holds? c (term value))) (term (check ...))))]
  [(meets? (Default ty value_d) value) (meets? ty value)]
  [(meets? ty value) #t])

;; make: a valid argument is kept; otherwise the default, which must meet the
;; constraints. A default that breaks them, like "" for len(1), makes the field
;; required.
(define-metafunction Types
  make-field : ty arg? owner -> value
  [(make-field ty value owner) value
   (judgment-holds (valid ty value owner))]
  [(make-field ty arg? owner) value_d
   (where value_d (default-of ty owner))
   (where #t (meets? ty value_d))])

(module+ test
  (require rackunit)
  (test-equal (valid? 'Any '(arr 1) 'none) #t)
  (test-equal (valid? 'String "a" 'none) #t)
  (test-equal (valid? 'String 1 'none) #f)
  (test-equal (valid? 'Number 1.5 'none) #t)
  (test-equal (valid? 'Number +nan.0 'none) #f)
  (test-equal (valid? 'Boolean #f 'none) #t)
  (test-equal (valid? 'Boolean 0 'none) #f)
  ;; Constraints narrow a kind; a throwing predicate does not hold.
  (test-equal (valid? '(Refine Number int (min 0) (max 9)) 3 'none) #t)
  (test-equal (valid? '(Refine Number int (min 0) (max 9)) 10 'none) #f)
  (test-equal (valid? '(Refine Number int) 1.5 'none) #f)
  (test-equal (valid? '(Refine String (len 1)) "" 'none) #f)
  (test-equal (valid? '(Refine String (len 1 2)) "abc" 'none) #f)
  (test-equal (valid? '(Refine String (min 1)) "a" 'none) #f)
  (test-equal (valid? '(Refine Any (pred x (< x 3))) 1 'none) #t)
  (test-equal (valid? '(Refine Any (pred x (< x 3))) "a" 'none) #f)
  (test-equal (valid? '(Default String "d") "x" 'none) #t)

  ;; Defaults, and making a field from an argument.
  (test-equal (term (default-of String none)) "")
  (test-equal (term (default-of (Refine Number (min 1)) none)) 1)
  (test-equal (term (default-of (Refine Number (max -2)) none)) -2)
  (test-equal (term (make-field Number 5 none)) 5)
  (test-equal (term (make-field Number "five" none)) 0)
  (test-equal (term (make-field Number absent none)) 0)
  (test-equal (term (make-field (Default String "d") absent none)) "d")
  ;; No default: one that breaks the constraints.
  (check-exn exn:fail? (λ () (term (make-field (Refine String (len 1)) absent none))))
  (check-exn exn:fail? (λ () (term (make-field (Default (Refine Number (min 1)) 0) absent none))))
  (test-results))
