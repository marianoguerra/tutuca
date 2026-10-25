#lang racket
;; DOM layer: what toDom produces from vnodes.
;;
;; Not modeled: setProp's browser coercion (removing null/false attributes,
;; property vs attribute writes), dangerouslySetInnerHTML, applying value and
;; checked after the children, and the `is` option.
(require redex/reduction-semantics "vnode.rkt")
(provide DOM child-ns to-dom render render-into)

(define-extended-language DOM VDom
  (dom ::= (element ns tag (prop ...) (dom ...)) (text string) (comment string)))

;; The namespace an element's children inherit: foreignObject inside SVG
;; switches back to HTML.
(define-metafunction DOM
  child-ns : tag ns -> ns
  [(child-ns tag ns) ,HTML-NS
   (side-condition (and (equal? (term ns) SVG-NS)
                        (string-ci=? (term tag) "foreignObject")))]
  [(child-ns tag ns) ns])

;; A vnode contributes a DOM sequence: fragments have no wrapper node.
(define-metafunction DOM
  to-dom : node ns -> (dom ...)
  [(to-dom (text string) ns) ((text string))]
  [(to-dom (comment string) ns) ((comment string))]
  [(to-dom (group key? (node ...)) ns) (render-into (node ...) ns)]
  [(to-dom (el tid tag none key? (prop ...) (node ...)) ns)
   (to-dom (el tid tag ns key? (prop ...) (node ...)) ns)]
  [(to-dom (el tid tag ns_el key? (prop ...) (node ...)) ns)
   ((element ns_el tag (prop ...) (render-into (node ...) (child-ns tag ns_el))))])

(define-metafunction DOM
  render-into : (node ...) ns -> (dom ...)
  [(render-into (node ...) ns) (dom ... ...)
   (where ((dom ...) ...) ((to-dom node ns) ...))])

;; render: the root sequence, the container's children, in an HTML container.
(define-metafunction DOM
  render : (node ...) -> (dom ...)
  [(render (node ...)) (render-into (node ...) ,HTML-NS)])

(module+ test
  (define H HTML-NS)
  (test-equal (redex-match? DOM dom (term (element ,H "br" () ()))) #t)
  ;; DOM elements have no key slot and no template id.
  (test-equal (redex-match? DOM dom (term (element ,H "br" "k" () ()))) #f)
  (test-equal (term (render ((el 0 "input" none "k" ((type "text")) ()))))
              (term ((element ,H "input" ((type "text")) ()))))
  ;; Groups have no wrapper and may contribute nothing.
  (test-equal (term (render ((group "a" ((text "A") (comment "a")))
                             (group none ((group "e" ()) (group "b" ((text "B"))))))))
              (term ((text "A") (comment "a") (text "B"))))
  ;; Namespaces: svg and math are detected by make-el, inherited by children,
  ;; and foreignObject resets to HTML; an explicit namespace wins.
  (define tree
    (term (el 0 "div" none none ()
              ((make-el 1 "SVG" none none () ((el 2 "circle" none none () ())
                                              (el 3 "foreignObject" none none ()
                                                  ((el 4 "span" none none () ())))))
               (make-el 5 "math" none none () ((el 6 "mi" none none () ())))
               (el 7 "g" ,SVG-NS none () ())))))
  (test-equal (term (render (,tree)))
              (term ((element ,H "div" ()
                              ((element ,SVG-NS "svg" ()
                                        ((element ,SVG-NS "circle" () ())
                                         (element ,SVG-NS "foreignObject" ()
                                                  ((element ,H "span" () ())))))
                               (element ,MATH-NS "math" () ((element ,MATH-NS "mi" () ())))
                               (element ,SVG-NS "g" () ()))))))
  (test-results))
