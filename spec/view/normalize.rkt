#lang racket
;; Normalization: addChild/toVChilds in view.js, from the values expressions
;; evaluate to (results) to a flat sequence of semantic nodes.
(require redex/reduction-semantics "../data.rkt" "sem.rkt")
(provide Norm normalize key-of)

(define-extended-language Norm Sem
  ;; What an expression evaluates to: a value, a node, or an iterable of
  ;; results (a custom node returning several roots).
  (result ::= value snode (frag result ...)))

;; Iterables (arrays and frags, never strings) splice; null drops; nodes stay;
;; anything else becomes text with String().
(define-metafunction Norm
  normalize : result -> (snode ...)
  [(normalize null) ()]
  [(normalize snode) (snode)]
  [(normalize (frag result ...)) (snode ... ...)
   (where ((snode ...) ...) ((normalize result) ...))]
  [(normalize (arr value ...)) (snode ... ...)
   (where ((snode ...) ...) ((normalize value) ...))]
  [(normalize value) ((text ,(js-string (term value))))])

;; key != null ? String(key) : undefined
(define-metafunction Norm
  key-of : result -> key?
  [(key-of null) none]
  [(key-of result) ,(js-string (term result))])

(module+ test
  (require rackunit)
  (test-equal (term (normalize null)) (term ()))
  (test-equal (term (normalize "hi")) (term ((text "hi"))))
  (test-equal (term (normalize 1)) (term ((text "1"))))
  (test-equal (term (normalize #t)) (term ((text "true"))))
  ;; Records are not iterable: String() gives "[object Object]". A component
  ;; has no toString, so String() throws.
  (test-equal (term (normalize (rec (a 1)))) (term ((text "[object Object]"))))
  (check-exn exn:fail? (λ () (term (normalize (comp C)))))
  ;; Leaves, elements, groups and wrappers are already nodes.
  (test-equal (term (normalize (comment "c"))) (term ((comment "c"))))
  (test-equal (term (normalize (component C ()))) (term ((component C ()))))
  (test-equal (term (normalize (group none ()))) (term ((group none ()))))
  ;; Iterables flatten to any depth and drop nulls along the way; arrays too.
  (test-equal (term (normalize (frag 1 (frag #t (arr null "x")))))
              (term ((text "1") (text "true") (text "x"))))
  (test-equal (term (normalize (frag))) (term ()))
  (test-equal (term (normalize (frag (group "a" ((text "A"))) (el 0 "b" none none () () ()))))
              (term ((group "a" ((text "A"))) (el 0 "b" none none () () ()))))
  ;; Keys become strings; null is no key.
  (test-equal (term (key-of null)) (term none))
  (test-equal (term (key-of 1)) "1")
  (test-equal (term (key-of "k")) "k")

  ;; Normalizing a normalized sequence changes nothing. A component in text
  ;; position throws (String(instance)), so those results are skipped.
  (define (has-comp? t) (and (pair? t) (or (eq? (car t) 'comp) (ormap has-comp? t))))
  (test-equal (redex-check Norm result
               (or (has-comp? (term result))
                   (let ([ns (term (normalize result))])
                     (equal? (term (normalize (frag ,@ns))) ns)))
               #:attempts 300 #:print? #f) #t)
  (test-results))
