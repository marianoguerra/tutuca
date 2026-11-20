#lang racket
;; The semantic tree: what evaluating a view produces.
;;
;; It says what the rendered tree means, not how the DOM records it. Wrapper
;; nodes say that their children are the render of a component.
(require redex/reduction-semantics "../component/class.rkt")
(provide Sem)

(define-extended-language Sem Class
  (tag ::= string)
  (ns ::= string)                          ; a namespace URI
  (ns? ::= ns none)                        ; none: the element inherits its parent's
  (tid ::= natural)                        ; the template the element comes from
  (key? ::= string none)
  (prop-name ::= (variable-except key namespace null))
  ;; Props retain element and iterable values without turning them into children.
  (prop-value ::= value snode (frag prop-value ...))
  (prop ::= (prop-name prop-value))
  (snode ::= (el tid tag ns? key? (prop ...) (snode ...))
             (text string)
             (comment string)                   ; a comment the view itself writes
             (group key? (snode ...))           ; an explicit fragment: a sibling key scope
             (component cname (snode ...))))    ; the render of an instance of cname

(module+ test
  (test-equal (redex-match? Sem snode (term (el 0 "b" none none ((class "x")) ((text "hi"))))) #t)
  (test-equal (redex-match? Sem snode (term (group "a" ((comment "c") (text "t"))))) #t)
  ;; key and namespace are never props: they have their own slots.
  (test-equal (redex-match? Sem prop (term (key "k"))) #f)
  (test-equal (redex-match? Sem snode (term (component Counter ((text "0"))))) #t)
  ;; Wrappers hold normalized children.
  (test-equal (redex-match? Sem snode (term (component C ("x")))) #f)
  ;; Children are already nodes.
  (test-equal (redex-match? Sem snode (term (el 0 "b" none none () ("hi")))) #f)
  (test-results))
