#lang racket
;; Lowering: from the semantic tree to vnodes (wrapMeta, planElement's data-eid
;; and the loop fragments in view.js). This is what binds the tutuca side to
;; the vdom; the encoding it picks is an implementation detail of the binding.
;;
;; A component or frame wrapper becomes its metadata comment, its children and
;; the closing comment. A loop becomes an unkeyed fragment of keyed item
;; fragments, so each loop is its own sibling key scope, and each item is
;; wrapped in its frame's metadata. An element with handlers gets the data-eid
;; attribute routing looks it up by; its handlers stay in the class's table.
(require redex/reduction-semantics "../view/sem.rkt" "../view/view.rkt" "../vdom/vnode.rkt" "meta.rkt")
(provide Lower lower lower-all lower-entry lower-props lower-value eid-props wrap lower-root)

(define-union-language Lower View VDom Meta)

(define-metafunction Lower
  wrap : meta (node ...) -> (node ...)
  [(wrap meta (node ...)) ((comment ,(meta->string (term meta))) node ... (comment ,META-CLOSE))])

(define-metafunction Lower
  eid-props : tid (on-attr ...) -> (prop ...)
  [(eid-props tid ()) ()]
  [(eid-props tid (on-attr_0 on-attr ...)) ((data-eid tid))])

(define-metafunction Lower
  lower : snode -> (node ...)
  [(lower (text string)) ((text string))]
  [(lower (comment string)) ((comment string))]
  [(lower (group key? (snode ...))) ((group key? (lower-all (snode ...))))]
  [(lower (el tid tag ns? key? (prop ...) (on-attr ...) (snode ...)))
   ((make-el tid tag ns? key? (prop_l ... prop_eid ...) (lower-all (snode ...))))
   (where (prop_l ...) (lower-props (prop ...)))
   (where (prop_eid ...) (eid-props tid (on-attr ...)))]
  [(lower (component cname (snode ...))) (wrap component (lower-all (snode ...)))]
  [(lower (enter dframe (snode ...))) (wrap (frame-meta dframe) (lower-all (snode ...)))]
  [(lower (items entry ...)) ((group none ((lower-entry entry) ...)))])

(define-metafunction Lower
  lower-entry : entry -> node
  [(lower-entry (item key? dframe (snode ...)))
   (group key? (wrap (frame-meta dframe) (lower-all (snode ...))))])

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
  (require rackunit)
  (define C (meta->string 'component))
  (define E META-CLOSE)
  (define (render classes root) (term (lower-root (register-components ,classes) ,root)))

  ;; components are wrapped in meta comments (view-semantics.test.js)
  (test-equal (render (term ((component C (views ("main" (h 1 "b" () "x")))))) '(comp C))
              `((comment ,C) (el 1 "b" none none () ((text "x"))) (comment ,E)))

  ;; Handlers never render; an element with handlers renders data-eid, and
  ;; props are sorted.
  (test-equal (term (lower (el 4 "button" none none ((title "t") (class "b")) ((on click (send go))) ())))
              (term ((el 4 "button" none none ((class "b") (data-eid 4) (title "t")) ()))))
  ;; svg and math are detected here, by the vdom's Shape.
  (test-equal (term (lower (el 1 "SVG" none none () () ())))
              (term ((el 1 "svg" ,SVG-NS none () ()))))

  ;; A frame wrapper writes the frame without cf, then a component boundary.
  (test-equal (term (lower (enter (frame none ("todo") none #t) ((component Todo ((text "T")))))))
              `((comment ,(meta->string '(frame none ("todo") none))) (comment ,C) (text "T")
                (comment ,E) (comment ,E)))

  ;; A loop: one unkeyed group of keyed item groups, each between its frame's metadata.
  (test-equal (term (lower (items (item "a" (frame none ("items") 0 #f) ((text "a")))
                                  (item none (frame none ("items") 1 #f) ()))))
              `((group none ((group "a" ((comment ,(meta->string '(frame none ("items") 0)))
                                         (text "a") (comment ,E)))
                             (group none ((comment ,(meta->string '(frame none ("items") 1)))
                                          (comment ,E)))))))

  ;; Elements in props lower to vnode values.
  (test-equal (term (lower (el 0 "p" none none ((title (el 1 "b" none none () ((on click (send x))) ()))) () ())))
              (term ((el 0 "p" none none ((title (el 1 "b" none none ((data-eid 1)) ()))) ()))))
  (test-results))
