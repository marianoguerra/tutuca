#lang racket
;; Field types: the t.* builders of schema.js, what values they accept, and how
;; a field is made from an argument or its default.
;;
;; A type is a term. Refine adds the constraints of int(), min(), max(),
;; len() and where(); Default is .default(v). An owner is the component holding
;; the field, which index types read: the keys of one of its other fields.
;; Inside arrays, maps and records the runtime passes no owner. The model
;; leaves out match() (regular expressions), sync levels and pbt generators.
(require redex/reduction-semantics "../data.rkt" "expr.rkt")
(provide Types valid valid? default-of make-field meets? type-length)

(define-extended-language Types Expr
  (ty ::= Any String Number Boolean (Enum value ...) (Option ty) (Array ty) (Map ty)
          (Record (fname ty) ...) (OneOf ty ...) (Index fname) (Component cname ...)
          (Refine ty check ...) (Default ty value))
  (check ::= int (min number) (max number) (len natural) (len natural natural) (pred x hx))
  (owner ::= value none)
  (arg? ::= value absent))                 ; a make argument, or undefined

;; lengthOf: string and array length, or a record's number of keys.
(define (type-length v)
  (match v
    [(? string?) (string-length v)]
    [(list 'arr vs ...) (length vs)]
    [(list 'rec fs ...) (length fs)]
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

(define (keys-in owner f)
  (match (if (eq? owner 'none) 'null (term (prop-get ,owner ,f)))
    [(list 'arr vs ...) (range (length vs))]
    [(list 'rec (list ks _) ...) (map symbol->string ks)]
    [_ '()]))

(define (key-of-entry k) (if (symbol? k) (symbol->string k) k))

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
  [(side-condition ,(member (term value) (term (value_m ...))))
   ----------------------- "enum"
   (valid (Enum value_m ...) value owner)]
  [----------------------- "option-null"
   (valid (Option ty) null owner)]
  [(valid ty value owner)
   ----------------------- "option"
   (valid (Option ty) value owner)]
  [(valid ty value none) ...
   ----------------------- "array"
   (valid (Array ty) (arr value ...) owner)]
  [(valid ty value none) ...
   ----------------------- "map"
   (valid (Map ty) (rec (fname value) ...) owner)]
  [(side-condition ,(equal? (sort (term (fname ...)) symbol<?) (sort (term (fname_s ...)) symbol<?)))
   (valid ty (field-of (fname value) ... fname_s) none) ...
   ----------------------- "record"
   (valid (Record (fname_s ty) ...) (rec (fname value) ...) owner)]
  [(valid ty_i value owner)
   ----------------------- "one-of"
   (valid (OneOf ty_1 ... ty_i ty_2 ...) value owner)]
  [(side-condition ,(or (exact-nonnegative-integer? (term value)) (string? (term value))))
   ----------------------- "index-kind"
   (valid (Index fname) value none)]
  [(side-condition ,(member (term value) (keys-in (term value_o) (term fname))))
   ----------------------- "index"
   (valid (Index fname) value value_o)]
  [(side-condition ,(or (null? (term (cname ...))) (memq (term cname_v) (term (cname ...)))))
   ----------------------- "component"
   (valid (Component cname ...) (comp cname_v any ...) owner)]
  [(valid ty value owner)
   (side-condition ,(andmap (λ (c) (check-holds? c (term value))) (term (check ...))))
   ----------------------- "refine"
   (valid (Refine ty check ...) value owner)]
  [(valid ty value owner)
   ----------------------- "default"
   (valid (Default ty value_d) value owner)])

(define-metafunction Types
  field-of : (fname value) ... fname -> value
  [(field-of any_1 ... (fname value) any_2 ... fname) value]
  [(field-of any ... fname) absent])

(define (valid? ty v owner) (judgment-holds (valid ,ty ,v ,owner)))

;; makeDefault: the value an absent argument becomes; undefined when there is
;; none (NoDefaultError). Bounds pull Number's zero default in, as
;; NumberType.min and max do. A record makes each key, and a union its first
;; alternative, as a field with no argument, so their defaults meet the
;; constraints of what they are made of.
(define-metafunction Types
  default-of : ty owner -> value
  [(default-of Any owner) null]
  [(default-of String owner) ""]
  [(default-of Number owner) 0]
  [(default-of Boolean owner) #f]
  [(default-of (Enum value_0 value ...) owner) value_0]
  [(default-of (Option ty) owner) null]
  [(default-of (Array ty) owner) (arr)]
  [(default-of (Map ty) owner) (rec)]
  [(default-of (Record (fname ty) ...) owner) (rec (fname (make-field ty absent none)) ...)]
  [(default-of (OneOf ty_0 ty ...) owner) (make-field ty_0 absent owner)]
  [(default-of (Index fname) value) ,(first (term (skey_0 skey ...)))
   (where (skey_0 skey ...) ,(keys-in (term value) (term fname)))]
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
;; constraints. A default that breaks them, like [] for len(1), makes the field
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
  (test-equal (valid? 'String "a" 'none) #t)
  (test-equal (valid? 'String 1 'none) #f)
  (test-equal (valid? 'Number +nan.0 'none) #f)
  (test-equal (valid? '(Option Number) 'null 'none) #t)
  (test-equal (valid? '(Array (Enum "a" "b")) '(arr "a" "b") 'none) #t)
  (test-equal (valid? '(Array (Enum "a" "b")) '(arr "c") 'none) #f)
  (test-equal (valid? '(Map Number) '(rec (x 1) (y 2)) 'none) #t)
  ;; Records have exactly the keys of their shape.
  (test-equal (valid? '(Record (a Number) (b String)) '(rec (b "x") (a 1)) 'none) #t)
  (test-equal (valid? '(Record (a Number)) '(rec (a 1) (b 2)) 'none) #f)
  (test-equal (valid? '(Record (a Number)) '(rec) 'none) #f)
  (test-equal (valid? '(OneOf Number String) "x" 'none) #t)
  ;; An index is a key of the owner's field; without an owner, only its kind is checked.
  (test-equal (valid? '(Index items) 1 '(comp C (items (arr "a" "b")))) #t)
  (test-equal (valid? '(Index items) 2 '(comp C (items (arr "a" "b")))) #f)
  (test-equal (valid? '(Index items) "x" '(comp C (items (rec (x 1))))) #t)
  (test-equal (valid? '(Index items) 7 'none) #t)
  (test-equal (valid? '(Component Item) '(comp Item) 'none) #t)
  (test-equal (valid? '(Component Item) '(comp Other) 'none) #f)
  (test-equal (valid? '(Component) '(comp Other) 'none) #t)
  ;; Constraints narrow a kind; a throwing predicate does not hold.
  (test-equal (valid? '(Refine Number int (min 0) (max 9)) 3 'none) #t)
  (test-equal (valid? '(Refine Number int) 1.5 'none) #f)
  (test-equal (valid? '(Refine String (len 1)) "" 'none) #f)
  (test-equal (valid? '(Refine (Array Any) (len 1 2)) '(arr 1 2 3) 'none) #f)
  (test-equal (valid? '(Refine Any (pred x (< x 3))) 1 'none) #t)
  (test-equal (valid? '(Refine Any (pred x (< x 3))) "a" 'none) #f)

  ;; Defaults, and making a field from an argument.
  (test-equal (term (default-of (Record (a Number) (b (Option String))) none)) '(rec (a 0) (b null)))
  (test-equal (term (default-of (Refine Number (min 1)) none)) 1)
  (test-equal (term (make-field Number 5 none)) 5)
  (test-equal (term (make-field Number "five" none)) 0)
  (test-equal (term (make-field (Default String "d") absent none)) "d")
  (test-equal (term (make-field (Index items) absent (comp C (items (arr "a"))))) 0)
  ;; No default: a required component, an index into nothing, a default that
  ;; breaks the constraints.
  (check-exn exn:fail? (λ () (term (make-field (Component Item) absent none))))
  (check-exn exn:fail? (λ () (term (make-field (Index items) absent (comp C (items (arr)))))))
  (check-exn exn:fail? (λ () (term (make-field (Refine (Array Any) (len 1)) absent none))))
  (check-exn exn:fail? (λ () (term (make-field (Default (Refine Number (min 1)) 0) absent none))))

  ;; make keeps every valid argument, and otherwise yields the default.
  (test-equal (redex-check Types (ty value)
                           (let ([made (with-handlers ([exn:fail? (λ (_) 'undefined)])
                                         (term (make-field ty value none)))])
                             (if (valid? (term ty) (term value) 'none)
                                 (equal? made (term value))
                                 (or (eq? made 'undefined)
                                     (equal? made (term (default-of ty none))))))
                           #:attempts 500 #:print? #f)
              #t)
  ;; make yields a valid value, for types whose .default(v) values have their
  ;; type and whose records have distinct keys.
  (define (well-formed? ty)
    (match ty
      [(list 'Default t v) (and (well-formed? t) (valid? t v 'none))]
      [(list 'Record (list fs ts) ...) (and (= (length fs) (length (remove-duplicates fs)))
                                            (andmap well-formed? ts))]
      [(list (or 'Option 'Array 'Map) t) (well-formed? t)]
      [(list 'OneOf ts ...) (andmap well-formed? ts)]
      [(list 'Refine t _ ...) (well-formed? t)]
      [_ #t]))
  (test-equal (redex-check Types (ty value)
                           (let ([made (with-handlers ([exn:fail? (λ (_) #f)])
                                         (term (make-field ty value none)))])
                             (or (not made) (not (well-formed? (term ty)))
                                 (valid? (term ty) made 'none)))
                           #:attempts 1000 #:print? #f)
              #t)
  ;; A record's default makes each key, and a union's its first alternative,
  ;; with their constraints.
  (check-exn exn:fail? (λ () (term (make-field (Record (n (Refine Number (min 1) (pred x (= x 3))))) absent none))))
  (test-equal (term (make-field (Record (n (Default (Refine Number (pred x (= x 3))) 3))) absent none)) '(rec (n 3)))
  (check-exn exn:fail? (λ () (term (make-field (OneOf (Refine String (len 1)) Number) absent none))))
  (test-equal (term (make-field (OneOf (Refine (Default String "a") (len 1))) absent none)) "a")
  (test-results))
