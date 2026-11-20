#lang racket
;; Paths.
;;
;;   upath   an update path: the property keys from the root state to a value.
;;           get-in and set-in read and write through it.
(require redex/reduction-semantics "../data.rkt")
(provide Paths get-in set-in)

(define-extended-language Paths Data
  (skey ::= natural string)            ; a property key in a path
  (upath ::= (skey ...)))

;; getIn: one property read per key.
(define-metafunction Paths
  get-in : upath value -> value
  [(get-in () value) value]
  [(get-in (skey_0 skey ...) value) (get-in (skey ...) (prop-get value skey_0))])

;; setIn, as a new root.
(define-metafunction Paths
  set-in : upath value value -> value
  [(set-in () value_root value) value]
  [(set-in (skey_0 skey ...) value_root value)
   (prop-set value_root skey_0 (set-in (skey ...) (prop-get value_root skey_0) value))])

(module+ test
  (require rackunit)
  (define root
    (term (rec (selected 1)
               (items (arr (rec (count 0) (kids (arr)))
                           (rec (count 5) (kids (arr (rec (count 7)))))))
               (child (rec (count 2))))))

  (test-equal (term (get-in () ,root)) root)
  (test-equal (term (get-in ("child" "count") ,root)) 2)
  (test-equal (term (get-in ("items" 1 "count") ,root)) 5)
  (test-equal (term (get-in ("items" 1 "kids" 0 "count") ,root)) 7)
  (test-equal (term (get-in ("items" 1 "count") (set-in ("items" 1 "count") ,root 6))) 6)
  (test-equal (term (set-in () ,root 1)) 1)
  ;; A missing key reads as null.
  (test-equal (term (get-in ("missing") ,root)) 'null)
  ;; Reading below null throws.
  (check-exn exn:fail? (λ () (term (get-in ("missing" "x" "y") ,root))))
  (test-results))
