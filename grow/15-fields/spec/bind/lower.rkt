#lang racket
;; Lowering: from the semantic tree to vnodes. This is what binds the tutuca
;; side to the vdom; the encoding it picks is an implementation detail of the
;; binding.
;;
;; The vdom is given: its vnodes are spec/vdom/vnode.rkt's, and what they
;; render to is spec/vdom/dom.rkt's.
(require redex/reduction-semantics "../view/sem.rkt" "../view/view.rkt"
         "../../../../spec/vdom/vnode.rkt")
(provide Lower lower lower-all lower-props lower-value lower-root)

(define-union-language Lower View VDom)

(define-metafunction Lower
  lower : snode -> (node ...)
  [(lower (text string)) ((text string))]
  [(lower (comment string)) ((comment string))]
  [(lower (group key? (snode ...))) ((group key? (lower-all (snode ...))))]
  [(lower (el tid tag ns? key? (prop ...) (snode ...)))
   ((make-el tid tag ns? key? (lower-props (prop ...)) (lower-all (snode ...))))]
  ;; The render of a component is its children: the DOM has no node for it.
  [(lower (component cname (snode ...))) (lower-all (snode ...))])

(define-metafunction Lower
  lower-all : (snode ...) -> (node ...)
  [(lower-all (snode ...)) (node ... ...)
   (where ((node ...) ...) ((lower snode) ...))])

;; Elements in props are vnode values; a wrapper there is the iterable of its
;; lowered nodes.
(define-metafunction Lower
  lower-props : (prop ...) -> (prop ...)
  [(lower-props ((prop-name any) ...)) ((prop-name (lower-value any)) ...)])

(define-metafunction Lower
  lower-value : any -> any
  [(lower-value (frag any ...)) (frag (lower-value any) ...)]
  [(lower-value snode) node (where (node) (lower snode))]
  [(lower-value snode) (frag node ...) (where (node ...) (lower snode))]
  [(lower-value value) value])

;; Host.render: the vnodes of the root component's view.
(define-metafunction Lower
  lower-root : registry value -> (node ...)
  [(lower-root registry value) (lower-all (render-root registry value))])

(module+ test
  (require rackunit "../../../../spec/vdom/dom.rkt")
  (define (lowered classes root) (term (lower-root (register-components ,classes) ,root)))

  ;; A component lowers to what its view lowers to.
  (test-equal (lowered (term ((component C (views ("main" (h 1 "b" () "x")))))) '(comp C))
              '((el 1 "b" none none () ((text "x")))))
  ;; Props are sorted, as the vdom keeps them.
  (test-equal (term (lower (el 4 "button" none none ((title "t") (class "b")) ())))
              (term ((el 4 "button" none none ((class "b") (title "t")) ()))))
  ;; svg and math are detected here, by the vdom's Shape.
  (test-equal (term (lower (el 1 "SVG" none none () ())))
              (term ((el 1 "svg" ,SVG-NS none () ()))))
  ;; Groups keep their key; their children lower in place.
  (test-equal (term (lower (group "a" ((text "A") (component C ((comment "c")))))))
              (term ((group "a" ((text "A") (comment "c"))))))
  ;; Elements in props lower to vnode values.
  (test-equal (term (lower (el 0 "p" none none ((title (el 1 "b" none none () ()))) ())))
              (term ((el 0 "p" none none ((title (el 1 "b" none none () ()))) ()))))

  ;; Hello world: the DOM of a component, by the vdom's render.
  (define hello
    (term ((component Hello
             (views ("main" (h 0 "p" ((class "loud")) "Hello, " (h 1 "b" () "world") "!")))))))
  (test-equal (term (render ,(lowered hello '(comp Hello))))
              (term ((element ,HTML-NS "p" ((class "loud"))
                              ((text "Hello, ") (element ,HTML-NS "b" () ((text "world"))) (text "!"))))))
  ;; The page follows the value: the same view on two states.
  (define counter (term ((component Counter (fields (n Number)) (views ("main" (h 0 "p" () "count: " (field n))))))))
  (test-equal (term (render ,(lowered counter '(comp Counter (n 0)))))
              (term ((element ,HTML-NS "p" () ((text "count: ") (text "0"))))))
  (test-equal (term (render ,(lowered counter '(comp Counter (n 1)))))
              (term ((element ,HTML-NS "p" () ((text "count: ") (text "1"))))))
  (test-results))
