#lang racket
;; Data layer: the runtime values views read and handlers write.
;;
;; Arrays and plain records are the only objects. Missing properties read as
;; null, which stands for both null and undefined. Reading a property of null is
;; a TypeError in JS; the model leaves prop-get undefined there, and a
;; metafunction failing to match is how the whole model represents a thrown
;; exception.
(require redex/reduction-semantics)
(provide Data prop-get prop-set field-get field-set)

(define-language Data
  (atom ::= string number boolean)
  ;; Any symbol but null: field names like key or text stay usable in every layer.
  (fname ::= (variable-except null))
  (value ::= atom null
             (arr value ...)                 ; an Array
             (rec (fname value) ...))        ; a plain object, entries in insertion order
  ;; A property key: an array index, or a record field (as a symbol or the
  ;; string Object.entries produces).
  (pkey ::= natural string fname))

(define (key->symbol k) (if (string? k) (string->symbol k) k))

;; v[k]
(define-metafunction Data
  prop-get : value any -> value
  [(prop-get (arr value ...) natural)
   ,(list-ref (term (value ...)) (term natural))
   (side-condition (< (term natural) (length (term (value ...)))))]
  [(prop-get (arr value ...) any) null]
  [(prop-get (rec any_f ...) pkey) (field-get (any_f ...) ,(key->symbol (term pkey)))]
  [(prop-get (rec any_f ...) any) null]           ; keys the model does not coerce
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
   (where (any_r ...) (field-set (any_f ...) ,(key->symbol (term pkey)) value_new))])

(define-metafunction Data
  field-set : ((fname value) ...) fname value -> ((fname value) ...)
  [(field-set (any_1 ... (fname value_old) any_2 ...) fname value)
   (any_1 ... (fname value) any_2 ...)]
  [(field-set (any_f ...) fname value) (any_f ... (fname value))])

(module+ test
  (require rackunit)
  (test-equal (redex-match? Data value (term (rec (title "t") (tags (arr "a" "b"))))) #t)
  (test-equal (redex-match? Data value (term (rec (a 1) (b (rec))))) #t)
  (test-equal (redex-match? Data value (term none)) #f)

  ;; Property reads: missing is null, arrays index by position, entries keys are strings.
  (test-equal (term (prop-get (rec (a 1)) a)) 1)
  (test-equal (term (prop-get (rec (a 1)) "a")) 1)
  (test-equal (term (prop-get (rec (a 1)) b)) 'null)
  (test-equal (term (prop-get (arr "x" "y") 1)) "y")
  (test-equal (term (prop-get (arr "x") 5)) 'null)
  (test-equal (term (prop-get "str" a)) 'null)
  ;; null[k] throws.
  (check-exn exn:fail? (λ () (term (prop-get null a))))

  ;; Writes give a new value.
  (test-equal (term (prop-set (rec (a 1) (b 2)) a 3)) (term (rec (a 3) (b 2))))
  (test-equal (term (prop-set (rec) a 3)) (term (rec (a 3))))
  (test-equal (term (prop-set (arr 1 2) 1 9)) (term (arr 1 9)))
  (test-equal (term (prop-set (arr 1 2) 2 9)) (term (arr 1 2 9)))
  (test-results))
