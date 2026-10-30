#lang racket
;; Data layer: the runtime values views read and handlers write.
;;
;; Component instances are records tagged with their class. Arrays, plain
;; records and components are the only objects; JS functions are modeled by the
;; host language (host.rkt). Missing properties read as null, which stands for
;; both null and undefined. Reading a property of null is a TypeError in JS; the
;; model leaves prop-get undefined there, and a metafunction failing to match is
;; how the whole model represents a thrown exception.
(require redex/reduction-semantics)
(provide field-get field-set
         Data js-string truthy? prop-get prop-set entries-of comp-class)

(define-language Data
  (atom ::= string number boolean)
  ;; Any symbol but null: field names like key or text stay usable in every layer.
  (fname ::= (variable-except null))
  (cname ::= (variable-except null))
  (value ::= atom null
             (arr value ...)                 ; an Array
             (rec (fname value) ...)         ; a plain object, entries in insertion order
             (comp cname (fname value) ...)) ; a component instance of class cname
  ;; A property key: an array index, or a record/component field (as a symbol or
  ;; the string Object.entries produces).
  (pkey ::= natural string fname))

;; String(x) in JS
(define (js-string x)
  (match x
    [#t "true"]
    [#f "false"]
    ['null "null"]
    [(? string?) x]
    [(? exact-integer?) (number->string x)]
    [(? real?) (cond [(nan? x) "NaN"]
                     [(infinite? x) (if (positive? x) "Infinity" "-Infinity")]
                     [(integer? x) (number->string (inexact->exact x))]
                     [else (number->string x)])]
    [(list 'arr vs ...) (string-join (for/list ([v vs]) (if (eq? v 'null) "" (js-string v))) ",")]
    ;; A component's prototype is Object.create(null): it has no toString, so
    ;; String(instance) is a TypeError.
    [(list 'comp _ ...) (error 'js-string "String() of a component instance")]
    [_ "[object Object]"]))

;; JS truthiness: objects (arrays, records, components, vnodes) are truthy.
(define (truthy? v)
  (not (or (eq? v #f) (eq? v 'null) (equal? v "")
           (and (real? v) (or (zero? v) (nan? v))))))

(define (key->symbol k) (if (string? k) (string->symbol k) k))

;; v[k]
(define-metafunction Data
  prop-get : value any -> value
  [(prop-get (arr value ...) natural)
   ,(list-ref (term (value ...)) (term natural))
   (side-condition (< (term natural) (length (term (value ...)))))]
  [(prop-get (arr value ...) any) null]
  [(prop-get (rec any_f ...) pkey) (field-get (any_f ...) ,(key->symbol (term pkey)))]
  [(prop-get (comp cname any_f ...) pkey) (field-get (any_f ...) ,(key->symbol (term pkey)))]
  [(prop-get (rec any_f ...) any) null]           ; keys the model does not coerce
  [(prop-get (comp cname any_f ...) any) null]
  [(prop-get atom any) null])

(define-metafunction Data
  field-get : ((fname value) ...) any -> value
  [(field-get (any_1 ... (fname value) any_2 ...) fname) value]
  [(field-get any_fs any) null])

;; v[k] = x, as a new value: immer's structural sharing is plain substitution here.
(define-metafunction Data
  prop-set : value pkey value -> value
  [(prop-set (arr value ...) natural value_new)
   (arr ,@(list-set (term (value ...)) (term natural) (term value_new)))
   (side-condition (< (term natural) (length (term (value ...)))))]
  [(prop-set (arr value ...) natural value_new) (arr value ... value_new)
   (side-condition (= (term natural) (length (term (value ...)))))]
  [(prop-set (rec any_f ...) pkey value_new)
   (rec any_r ...)
   (where (any_r ...) (field-set (any_f ...) ,(key->symbol (term pkey)) value_new))]
  [(prop-set (comp cname any_f ...) pkey value_new)
   (comp cname any_r ...)
   (where (any_r ...) (field-set (any_f ...) ,(key->symbol (term pkey)) value_new))])

(define-metafunction Data
  field-set : ((fname value) ...) fname value -> ((fname value) ...)
  [(field-set (any_1 ... (fname value_old) any_2 ...) fname value)
   (any_1 ... (fname value) any_2 ...)]
  [(field-set (any_f ...) fname value) (any_f ... (fname value))])

;; entriesOf in each: an array's [index, item] pairs, otherwise Object.entries.
;; Object.entries of null throws, so null has no entries.
(define-metafunction Data
  entries-of : value -> ((pkey value) ...)
  [(entries-of (arr value ...))
   ,(for/list ([v (term (value ...))] [i (in-naturals)]) (list i v))]
  [(entries-of (rec (fname value) ...))
   ,(for/list ([f (term (fname ...))] [v (term (value ...))]) (list (symbol->string f) v))]
  ;; A component's own fields: not its identity, the reserved field @ (system/host.rkt).
  [(entries-of (comp cname any_f ...))
   (entries-of (rec ,@(filter (λ (f) (not (eq? (car f) '@))) (term (any_f ...)))))]
  [(entries-of atom) ()])

(define-metafunction Data
  comp-class : value -> cname
  [(comp-class (comp cname any ...)) cname])

(module+ test
  (require rackunit)
  (test-equal (redex-match? Data value (term (comp Todo (title "t") (tags (arr "a" "b"))))) #t)
  (test-equal (redex-match? Data value (term (rec (a 1) (b (rec))))) #t)
  (test-equal (redex-match? Data value (term none)) #f)

  ;; String() and truthiness follow JS.
  (test-equal (js-string 1.0) "1")
  (test-equal (js-string #f) "false")
  (test-equal (js-string '(arr 1 null "x")) "1,,x")
  (test-equal (js-string '(rec)) "[object Object]")
  (test-equal (map truthy? (list #f 0 "" 'null +nan.0 #t 1 "false" '(rec) '(arr)))
              '(#f #f #f #f #f #t #t #t #t #t))

  ;; Property reads: missing is null, arrays index by position, entries keys are strings.
  (test-equal (term (prop-get (rec (a 1)) a)) 1)
  (test-equal (term (prop-get (rec (a 1)) "a")) 1)
  (test-equal (term (prop-get (comp C (a 1)) b)) 'null)
  (test-equal (term (prop-get (arr "x" "y") 1)) "y")
  (test-equal (term (prop-get (arr "x") 5)) 'null)
  (test-equal (term (prop-get "str" a)) 'null)
  ;; null[k] throws.
  (check-exn exn:fail? (λ () (term (prop-get null a))))

  (test-equal (term (prop-set (comp C (a 1) (b 2)) a 3)) (term (comp C (a 3) (b 2))))
  (test-equal (term (prop-set (rec) a 3)) (term (rec (a 3))))
  (test-equal (term (prop-set (arr 1 2) 1 9)) (term (arr 1 9)))
  (test-equal (term (prop-set (arr 1 2) 2 9)) (term (arr 1 2 9)))

  (test-equal (term (entries-of (arr "a" "b"))) (term ((0 "a") (1 "b"))))
  (test-equal (term (entries-of (rec (x 1) (y 2)))) (term (("x" 1) ("y" 2))))
  (check-exn exn:fail? (λ () (term (entries-of null))))
  (test-results))
