#lang racket
;; Decoding: from the DOM node an event hit back to a handler and the path of
;; the component that owns it (getEventInfoFor in events.js).
;;
;; The rendered DOM carries no component references. Each element with
;; handlers has data-eid, and metadata comments mark where the semantic tree's
;; wrappers begin and end. Decoding walks from the target up to the container,
;; collects the eids met before the innermost component boundary, and reads the
;; metadata enclosing each ancestor to rebuild the path. view/route.rkt says
;; what the answer means on the semantic tree; the binding theorem
;; (system/tutuca.rkt) checks that decoding the lowered DOM gives it.
(require redex/reduction-semantics "../data.rkt" "../vdom/vnode.rkt" "../vdom/dom.rkt"
         "../component/paths.rkt" "../view/view.rkt" "meta.rkt" "lower.rkt")
(provide siblings-before scan eid-of walk frames-of
         Routing node-at enclosing-meta event-info addresses)

(define-union-language View+Meta View Meta)

(define-extended-language Routing View+Meta
  (dom ::= (element ns tag (prop ...) (dom ...)) (text string) (comment string))
  (addr ::= (natural ...))                 ; child indices from the container
  (info ::= (on-attr route) none))

(define-metafunction Routing
  node-at : (dom ...) addr -> dom
  [(node-at (dom ...) (natural)) ,(list-ref (term (dom ...)) (term natural))]
  [(node-at (dom ...) (natural_0 natural ...))
   (node-at (dom_c ...) (natural ...))
   (where (element ns tag (prop ...) (dom_c ...)) ,(list-ref (term (dom ...)) (term natural_0)))])

(define-metafunction Routing
  siblings-before : (dom ...) addr -> (dom ...)
  [(siblings-before (dom ...) (natural)) ,(take (term (dom ...)) (term natural))]
  [(siblings-before (dom ...) (natural_0 natural ...))
   (siblings-before (dom_c ...) (natural ...))
   (where (element ns tag (prop ...) (dom_c ...)) ,(list-ref (term (dom ...)) (term natural_0)))])

;; enclosingNodeMeta: scan previous siblings, nearest first. Each closing
;; comment hides one opening comment; any other comment, including look-alikes
;; that do not parse as metadata, is skipped.
(define-metafunction Routing
  enclosing-meta : (dom ...) addr -> (meta ...)
  [(enclosing-meta (dom ...) addr) (scan ,(reverse (term (siblings-before (dom ...) addr))) 0)])

(define (meta-like? s) (and (string-prefix? s "§{") (string-suffix? s "§")))

(define-metafunction Routing
  scan : (dom ...) natural -> (meta ...)
  [(scan () natural) ()]
  [(scan ((comment string) dom ...) natural) (scan (dom ...) ,(add1 (term natural)))
   (side-condition (equal? (term string) META-CLOSE))]
  [(scan ((comment string) dom ...) natural) (scan (dom ...) ,(sub1 (term natural)))
   (side-condition (meta-like? (term string)))
   (side-condition (> (term natural) 0))]
  [(scan ((comment string) dom ...) 0) (meta meta_rest ...)
   (where meta ,(string->meta (term string)))
   (where (meta_rest ...) (scan (dom ...) 0))]
  [(scan (dom_0 dom ...) natural) (scan (dom ...) natural)])

(define-metafunction Routing
  eid-of : dom -> any
  [(eid-of (element ns tag (any_1 ... (data-eid natural) any_2 ...) (dom ...))) natural]
  [(eid-of dom) #f])

;; The walk to the container: eids until the first component metadata (an
;; element's own eid counts even when its own enclosing metadata is the
;; component's), and every enclosing metadata, innermost first.
(define-metafunction Routing
  walk : (dom ...) addr boolean (natural ...) (meta ...) -> (boolean (natural ...) (meta ...))
  [(walk (dom ...) () boolean (natural ...) (meta ...)) (boolean (natural ...) (meta ...))]
  [(walk (dom ...) (natural_a ... natural_last) boolean (natural ...) (meta ...))
   (walk (dom ...) (natural_a ...) boolean_next (natural ... natural_new ...) (meta ... meta_here ...))
   (where addr (natural_a ... natural_last))
   (where (natural_new ...) ,(let ([eid (term (eid-of (node-at (dom ...) addr)))])
                               (if (and (not (term boolean)) eid) (list eid) '())))
   (where (meta_here ...) (enclosing-meta (dom ...) addr))
   (where boolean_next ,(or (term boolean) (and (memq 'component (term (meta_here ...))) #t)))])

;; Outermost first: each frame metadata is a frame; a component boundary
;; makes the frame before it a component frame.
(define-metafunction Routing
  frames-of : (meta ...) dpath -> dpath
  [(frames-of () dpath) dpath]
  [(frames-of (component meta ...) dpath) (frames-of (meta ...) (promote dpath))]
  [(frames-of (meta_0 meta ...) (dframe ...)) (frames-of (meta ...) (dframe ... (meta-frame meta_0)))])

;; The first handler for the event's type, over the eids innermost first, in
;; the table of the class of the instance the update path reaches.
(define-metafunction Routing
  event-info : registry value (dom ...) fname addr -> info
  [(event-info registry value (dom ...) fname addr) none
   (where (boolean (natural ...) (meta ...)) (walk (dom ...) addr #f () ()))
   (side-condition (or (not (term boolean)) (null? (term (natural ...)))))]
  [(event-info registry value (dom ...) fname addr)
   ,(or (for*/first ([eid (term (natural ...))]
                     [h (term (handlers-for registry (comp-class value_inst) ,eid))]
                     #:when (eq? (second h) (term fname)))
          (list h (term (dpath upath))))
        'none)
   (where (#t (natural ...) (meta ...)) (walk (dom ...) addr #f () ()))
   (where dpath (frames-of ,(reverse (term (meta ...))) ()))
   (where upath (to-update-path dpath))
   (where value_inst (get-in upath value))])

;; Addresses of the elements satisfying pred, in document order.
(define (addresses doms pred [prefix '()])
  (append*
   (for/list ([d doms] [i (in-naturals)])
     (define a (append prefix (list i)))
     (match d
       [(list 'element _ _ _ kids) (append (if (pred d) (list a) '()) (addresses kids pred a))]
       [_ '()]))))

(module+ test
  (require rackunit)
  (define (tag=? t) (λ (d) (equal? (third d) t)))
  (define (dom-of classes root)
    (define reg (term (register-components ,classes)))
    (values reg (term (render (lower-root ,reg ,root)))))

  ;; The scan skips closed siblings and look-alike comments.
  (define siblings
    (term ((comment "§{\"t\":\"component\"}§")
           (comment "§{\"t\":\"field\",\"v\":\"a\"}§") (text "x") (comment "§/§")
           (comment "ordinary") (comment "§{\"t\":\"it\"}§")
           (element "h" "b" () ()))))
  (test-equal (term (enclosing-meta ,siblings (6))) '(component))

  ;; A component in a field: the update path is the field.
  (define classes
    (term ((component Child (views ("main" (h 1 "button" ((on click (send inc))) "+"))))
           (component Root (views ("main" (h 2 "div" ((on click (send outer))) (x-render (field child) none))))))))
  (define-values (reg dom) (dom-of classes '(comp Root (child (comp Child)))))
  (match-define (list button) (addresses dom (tag=? "button")))
  (test-equal (term (event-info ,reg (comp Root (child (comp Child))) ,dom click ,button))
              (term ((on click (send inc)) (((frame none ("child") none #t)) ("child")))))
  ;; The root's own element routes to the root; an unknown event type finds nothing.
  (match-define (list div) (addresses dom (tag=? "div")))
  (test-equal (term (event-info ,reg (comp Root (child (comp Child))) ,dom click ,div))
              (term ((on click (send outer)) (() ()))))
  (test-equal (term (event-info ,reg (comp Root (child (comp Child))) ,dom input ,button)) 'none)

  ;; Outer eids stop at the first component boundary: a Child without a
  ;; handler for the event does not reach Root's div.
  (test-equal (term (event-info ,reg (comp Root (child (comp Child))) ,dom input ,div)) 'none)

  ;; Loop items inside a component's own view are not component frames.
  (define loop-classes
    (term ((component Root (views ("main" (each (field xs) (h 1 "button" ((on click (send pick (source-key))))) none)))))))
  (define-values (lreg ldom) (dom-of loop-classes '(comp Root (xs (arr 1 2)))))
  (test-equal (for/list ([a (addresses ldom (tag=? "button"))])
                (term (event-info ,lreg (comp Root (xs (arr 1 2))) ,ldom click ,a)))
              (term (((on click (send pick (source-key))) (((frame none ("xs") 0 #f)) ()))
                     ((on click (send pick (source-key))) (((frame none ("xs") 1 #f)) ())))))

  ;; An element outside any managed component is not routed.
  (define unmanaged (append ldom (term ((element ,HTML-NS "button" ((data-eid 1)) ())))))
  (test-equal (term (event-info ,lreg (comp Root (xs (arr 1 2))) ,unmanaged click (,(sub1 (length unmanaged)))))
              'none)
  (test-results))
