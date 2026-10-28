#lang racket
;; Decoding: from the DOM node an event hit back to a handler and the path of
;; the component that owns it (getEventInfoFor in events.js).
;;
;; The rendered DOM carries no component references. Each element with
;; handlers has data-eid, and metadata comments mark where the semantic tree's
;; wrappers begin and end. Decoding walks from the target up to the container,
;; collects the eids met before the innermost component boundary (before any
;; enclosing one for a drop event, which bubbles), and reads the metadata
;; enclosing each ancestor to rebuild the path. view/route.rkt says
;; what the answer means on the semantic tree; the binding theorem
;; (system/tutuca.rkt) checks that decoding the lowered DOM gives it.
(require redex/reduction-semantics "../data.rkt" "../vdom/vnode.rkt" "../vdom/dom.rkt"
         "../component/paths.rkt" "../view/view.rkt" "../view/route.rkt" "meta.rkt" "lower.rkt")
(provide siblings-before scan eid-of walk frames-of
         Routing node-at enclosing-meta event-info path-of addresses)

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

;; The walk to the container: every element's eid with its level, the number
;; of component boundaries met below it (an element's own eid counts at the
;; level below its own enclosing metadata), and every enclosing metadata,
;; innermost first.
(define-metafunction Routing
  walk : (dom ...) addr ((natural natural) ...) (meta ...) -> (((natural natural) ...) (meta ...))
  [(walk (dom ...) () any_e (meta ...)) (any_e (meta ...))]
  [(walk (dom ...) (natural_a ... natural_last) ((natural_e natural_l) ...) (meta ...))
   (walk (dom ...) (natural_a ...) ((natural_e natural_l) ... any_new ...) (meta ... meta_here ...))
   (where addr (natural_a ... natural_last))
   (where (any_new ...) ,(let ([eid (term (eid-of (node-at (dom ...) addr)))])
                           (if eid (list (list eid (count-components (term (meta ...))))) '())))
   (where (meta_here ...) (enclosing-meta (dom ...) addr))])

(define (count-components metas) (count (λ (m) (eq? m 'component)) metas))

;; Outermost first: each frame metadata is a frame; a component boundary
;; makes the frame before it a component frame.
(define-metafunction Routing
  frames-of : (meta ...) dpath -> dpath
  [(frames-of () dpath) dpath]
  [(frames-of (component meta ...) dpath) (frames-of (meta ...) (promote dpath))]
  [(frames-of (meta_0 meta ...) (dframe ...)) (frames-of (meta ...) (dframe ... (meta-frame meta_0)))])

;; The first handler for the event's type, over the eids of the nearest
;; component innermost first, in the table of the class of the instance the
;; update path reaches. A drop event bubbles: a level with no handler for it
;; leaves it to the next, whose path is the metadata outside the component
;; below, so its last frame is the child the event came through.
(define-metafunction Routing
  event-info : registry value (dom ...) fname addr -> info
  [(event-info registry value (dom ...) fname addr)
   ,(let* ([metas (term (meta ...))]
           [ends (for/list ([m metas] [i (in-naturals)] #:when (eq? m 'component)) i)]
           [levels (if (drop-event? (term fname)) (length ends) (min 1 (length ends)))])
      (or (for*/first ([level levels]
                       [dpath (in-value (term (frames-of ,(reverse (drop metas (if (zero? level) 0 (add1 (list-ref ends (sub1 level))))))
                                                         ())))]
                       [upath (in-value (term (to-update-path ,dpath)))]
                       [eid (for/list ([e (term ((natural_e natural_l) ...))] #:when (= (second e) level))
                              (first e))]
                       [h (term (handlers-for registry (comp-class (get-in ,upath value)) ,eid))]
                       #:when (eq? (second h) (term fname)))
            (list h (list dpath upath)))
          'none))
   (where (((natural_e natural_l) ...) (meta ...)) (walk (dom ...) addr () ()))])

;; pathOf: the dispatch path of the component (and the loop items in it) the
;; node at addr was rendered in; none outside any component.
(define-metafunction Routing
  path-of : (dom ...) addr -> any
  [(path-of (dom ...) addr)
   ,(if (memq 'component (term (meta ...))) (term (frames-of ,(reverse (term (meta ...))) ())) 'none)
   (where (any_e (meta ...)) (walk (dom ...) addr () ()))])

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

  ;; A drop on a child with no handler for it bubbles to the parent's list, at
  ;; the frame of the child it came through; a click doesn't.
  (define drop-classes
    (term ((component Child (views ("main" (h 1 "span" () "x"))))
           (component Root (views ("main" (h 2 "ul" ((on drop (send dropped)))
                                             (each (field kids) (render-it none) none))))))))
  (define drop-root '(comp Root (kids (arr (comp Child) (comp Child)))))
  (define-values (dreg ddom) (dom-of drop-classes drop-root))
  (match-define (list _ span1) (addresses ddom (tag=? "span")))
  (test-equal (term (event-info ,dreg ,drop-root ,ddom drop ,span1))
              (term ((on drop (send dropped)) (((frame none ("kids") 1 #f)) ()))))
  (test-equal (term (event-info ,dreg ,drop-root ,ddom click ,span1)) 'none)
  (test-equal (term (path-of ,ddom ,span1)) (term ((frame none ("kids") 1 #t))))

  ;; An element outside any managed component is not routed.
  (define unmanaged (append ldom (term ((element ,HTML-NS "button" ((data-eid 1)) ())))))
  (test-equal (term (event-info ,lreg (comp Root (xs (arr 1 2))) ,unmanaged click (,(sub1 (length unmanaged)))))
              'none)
  (test-results))
