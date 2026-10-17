#lang racket
;; Normalization: addChild/toVChilds in tutuca.js, from the values expressions
;; evaluate to (results) to a flat sequence of Core nodes.
(require redex/reduction-semantics "data.rkt" "core.rkt")
(provide Norm normalize key-of)

(define-extended-language Norm Core
  ;; What an expression evaluates to: a value, a vnode, or an iterable of
  ;; results (a custom node returning several roots, or wrapMeta's triple).
  (result ::= value node (frag result ...)))

;; Iterables (arrays and frags, never strings) splice; null drops; vnodes stay;
;; anything else becomes text with String().
(define-metafunction Norm
  normalize : result -> (node ...)
  [(normalize null) ()]
  [(normalize node) (node)]
  [(normalize (frag result ...)) (node ... ...)
   (where ((node ...) ...) ((normalize result) ...))]
  [(normalize (arr value ...)) (node ... ...)
   (where ((node ...) ...) ((normalize value) ...))]
  [(normalize value) ((text ,(js-string (term value))))])

;; key != null ? String(key) : undefined
(define-metafunction Norm
  key-of : result -> key?
  [(key-of null) none]
  [(key-of result) ,(js-string (term result))])

(module+ test
  (test-equal (term (normalize null)) (term ()))
  (test-equal (term (normalize "hi")) (term ((text "hi"))))
  (test-equal (term (normalize 1)) (term ((text "1"))))
  (test-equal (term (normalize #t)) (term ((text "true"))))
  ;; Records and components are not iterable: String() gives "[object Object]".
  (test-equal (term (normalize (rec (a 1)))) (term ((text "[object Object]"))))
  ;; Leaves, elements and groups are already nodes.
  (test-equal (term (normalize (comment "c"))) (term ((comment "c"))))
  (test-equal (term (normalize meta-close)) (term (meta-close)))
  (test-equal (term (normalize (group none ()))) (term ((group none ()))))
  ;; Iterables flatten to any depth and drop nulls along the way; arrays too.
  (test-equal (term (normalize (frag 1 (frag #t (arr null "x")))))
              (term ((text "1") (text "true") (text "x"))))
  (test-equal (term (normalize (frag))) (term ()))
  (test-equal (term (normalize (frag (group "a" ((text "A"))) (el 0 "b" none none () ()))))
              (term ((group "a" ((text "A"))) (el 0 "b" none none () ()))))
  ;; Keys become strings; null is no key.
  (test-equal (term (key-of null)) (term none))
  (test-equal (term (key-of 1)) "1")
  (test-equal (term (key-of "k")) "k")

  ;; Normalizing a normalized sequence changes nothing.
  (test-equal (redex-check Norm result
               (let ([ns (term (normalize result))])
                 (equal? (term (normalize (frag ,@ns))) ns))
               #:attempts 300 #:print? #f) #t)
  (test-results))
