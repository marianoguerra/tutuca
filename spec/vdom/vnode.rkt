#lang racket
;; Normalized vnodes (VText, VComment, VNode, VFragment and Shape in vdom.js).
;;
;; The vdom knows nothing about tutuca: comments are plain text, and props hold
;; opaque values. An element carries its template identity tid. In the runtime,
;; that is the element's Shape, shared by every render of one template:
;; VNode.isSameKind compares shapes and keys, so two templates with the same
;; tag replace rather than patch each other. Whether an attribute is static
;; (set once on create) or dynamic is an optimization of src/optimize.js; the
;; model keeps all of them as props, sorted by name, since attribute order is
;; not observable.
(require redex/reduction-semantics "../data.rkt")
(provide shape-of VDom HTML-NS SVG-NS MATH-NS make-el)

(define HTML-NS "http://www.w3.org/1999/xhtml")
(define SVG-NS "http://www.w3.org/2000/svg")
(define MATH-NS "http://www.w3.org/1998/Math/MathML")

(define-extended-language VDom Data
  (tag ::= string)
  (ns ::= string)                      ; a namespace URI
  (ns? ::= ns none)                    ; none: the element inherits its parent's
  (tid ::= natural)
  (key? ::= string none)               ; a key, or undefined
  (prop-name ::= (variable-except key namespace null))  ; key and namespace have their own slots
  ;; Props retain vnode and iterable values without turning them into children.
  (prop-value ::= value node (frag prop-value ...))
  (prop ::= (prop-name prop-value))
  (leaf ::= (text string) (comment string))
  ;; Explicit VFragments retain a sibling key scope, even without a key.
  (node ::= (el tid tag ns? key? (prop ...) (node ...))
            (group key? (node ...))
            leaf))

;; new Shape(tag, namespace, ...): with no explicit namespace, svg and math are
;; detected case-insensitively and set their own.
(define-metafunction VDom
  shape-of : tag ns? -> (tag ns?)
  [(shape-of tag none) (,(string-downcase (term tag)) ,SVG-NS)
   (side-condition (string-ci=? (term tag) "svg"))]
  [(shape-of tag none) (,(string-downcase (term tag)) ,MATH-NS)
   (side-condition (string-ci=? (term tag) "math"))]
  [(shape-of tag ns?) (tag ns?)])

(define (sort-props props)
  (define sorted (sort props symbol<? #:key car))
  (unless (equal? (remove-duplicates (map car sorted)) (map car sorted))
    (error 'make-el "duplicate prop names in ~a" props))
  sorted)

;; new VNode(shape, values, childs, key)
(define-metafunction VDom
  make-el : tid tag ns? key? (prop ...) (node ...) -> node
  [(make-el tid tag ns? key? (prop ...) (node ...))
   (el tid tag_s ns?_s key? ,(sort-props (term (prop ...))) (node ...))
   (where (tag_s ns?_s) (shape-of tag ns?))])

(module+ test
  ;; Tags are strings; keys are strings or none.
  (test-equal (redex-match? VDom tag (term "p")) #t)
  (test-equal (redex-match? VDom key? (term none)) #t)
  (test-equal (redex-match? VDom key? (term 1)) #f)

  ;; key and namespace are never props: they have their own slots.
  (test-equal (redex-match? VDom prop (term (id "x"))) #t)
  (test-equal (redex-match? VDom prop (term (key "k"))) #f)
  (test-equal (redex-match? VDom prop (term (namespace "n"))) #f)

  ;; Props hold any runtime value, vnodes, and iterables of those.
  (test-equal (redex-match? VDom prop (term (data (rec (a 1))))) #t)
  (test-equal (redex-match? VDom prop (term (title (el 0 "b" none none () ())))) #t)
  (test-equal (redex-match? VDom prop (term (title (frag "a" (group none ()))))) #t)

  ;; Elements carry a template id, an optional namespace and an optional key.
  (test-equal (redex-match? VDom node (term (el 0 "br" none none () ()))) #t)
  (test-equal (redex-match? VDom node (term (el 3 "li" none "a" ((class "x")) ((text "a"))))) #t)
  (test-equal (redex-match? VDom node (term (group none ((group "a" ()))))) #t)
  (test-equal (redex-match? VDom node (term (comment "§/§"))) #t)
  ;; Children are already normalized.
  (test-equal (redex-match? VDom node (term (el 0 "p" none none () ("hi")))) #f)

  ;; make-el sorts props and detects svg and math.
  (test-equal (term (make-el 1 "p" none none ((title "t") (id "x")) ()))
              (term (el 1 "p" none none ((id "x") (title "t")) ())))
  (test-equal (term (make-el 1 "SVG" none none () ()))
              (term (el 1 "svg" ,SVG-NS none () ())))
  (test-equal (term (make-el 1 "Math" none none () ()))
              (term (el 1 "math" ,MATH-NS none () ())))
  (test-equal (term (make-el 1 "g" ,SVG-NS none () ()))
              (term (el 1 "g" ,SVG-NS none () ())))
  (test-results))
