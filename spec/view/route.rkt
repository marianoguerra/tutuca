#lang racket
;; Routing on the semantic tree: which handler an event on an element runs,
;; and the route of the component that runs it.
;;
;; This is the meaning bind/decode.rkt implements over the DOM. Here nothing is
;; scanned: an element's dispatch path is the frames of the wrappers above it,
;; a component wrapper making the frame before it a component frame, and its
;; candidate handlers are its own, then those of the elements above it, up to
;; the nearest component wrapper. The drop events (dragenter, dragover,
;; dragleave, drop) bubble: when the nearest component has no handler for one,
;; the next enclosing component's elements above it are tried, at the frame of
;; the child the event came through, so its source key is that child's.
(require redex/reduction-semantics "../component/paths.rkt" "sem.rkt" "view.rkt")
(provide Sites sites-of sites-in site-info drop-event? outside)

(define-extended-language Sites View
  ;; One element in document order: a level per enclosing component, innermost
  ;; first, none outside any component. A level is the handler lists from the
  ;; element (or the component below) outwards to that component, and the
  ;; dispatch path they're routed at.
  (site ::= (elem (level ...)))
  (level ::= (((on-attr ...) ...) dpath)))

;; The events that reach the nearest enclosing component that handles them.
(define (drop-event? fname) (and (memq fname '(dragenter dragover dragleave drop)) #t))

;; The children's sites: the handler lists of the elements above them up to
;; their component, their dispatch path, the levels outside that component,
;; and whether a component encloses them.
(define-metafunction Sites
  sites-of : (snode ...) ((on-attr ...) ...) dpath (level ...) boolean -> (site ...)
  [(sites-of () any_hs dpath any_l boolean) ()]
  [(sites-of (snode_0 snode ...) any_hs dpath any_l boolean)
   (site_0 ... site ...)
   (where (site_0 ...) (sites-in snode_0 any_hs dpath any_l boolean))
   (where (site ...) (sites-of (snode ...) any_hs dpath any_l boolean))])

(define-metafunction Sites
  sites-in : snode ((on-attr ...) ...) dpath (level ...) boolean -> (site ...)
  [(sites-in (el tid tag ns? key? (prop ...) (on-attr ...) (snode ...)) (any_h ...) dpath (level ...) #t)
   ((elem ((((on-attr ...) any_h ...) dpath) level ...)) site_c ...)
   (where (site_c ...) (sites-of (snode ...) ((on-attr ...) any_h ...) dpath (level ...) #t))]
  [(sites-in (el tid tag ns? key? (prop ...) (on-attr ...) (snode ...)) any_hs dpath any_l #f)
   ((elem ()) site_c ...)
   (where (site_c ...) (sites-of (snode ...) () dpath () #f))]
  [(sites-in (component cname (snode ...)) any_hs dpath (level ...) #t)
   (sites-of (snode ...) () (promote dpath) ((any_hs (outside dpath)) level ...) #t)]
  [(sites-in (component cname (snode ...)) any_hs dpath any_l #f)
   (sites-of (snode ...) () (promote dpath) () #t)]
  [(sites-in (enter dframe (snode ...)) any_hs (dframe_p ...) any_l boolean)
   (sites-of (snode ...) any_hs (dframe_p ... dframe) any_l boolean)]
  [(sites-in (items (item key? dframe (snode ...)) ...) any_hs dpath any_l boolean)
   (site ... ...)
   (where ((site ...) ...) ((sites-in (enter dframe (snode ...)) any_hs dpath any_l boolean) ...))]
  [(sites-in (group key? (snode ...)) any_hs dpath any_l boolean)
   (sites-of (snode ...) any_hs dpath any_l boolean)]
  [(sites-in snode any_hs dpath any_l boolean) ()])

;; The path the enclosing component's level is routed at: the frame of the
;; child the event came through ends it, not as a component frame, so the
;; route is the enclosing component's and the source key the child's.
(define-metafunction Sites
  outside : dpath -> dpath
  [(outside ()) ()]
  [(outside (dframe ... (frame base any_k item? boolean))) (dframe ... (frame base any_k item? #f))])

;; The first handler for the event's type, innermost element first, with the
;; route it runs at, in the nearest component (in any enclosing one for a drop
;; event, nearest first); none outside any component.
(define-metafunction Sites
  site-info : site fname -> any
  [(site-info (elem (level ...)) fname)
   ,(or (for*/first ([l (let ([ls (term (level ...))])
                          (if (drop-event? (term fname)) ls (take ls (min 1 (length ls)))))]
                     [h (append* (first l))]
                     #:when (eq? (second h) (term fname)))
          (list h (term (,(second l) (to-update-path ,(second l))))))
        'none)])

(module+ test
  (require rackunit)
  (define (sites classes root)
    (term (sites-of (render-root (register-components ,classes) ,root) () () () #f)))
  (define classes
    (term ((component Child (views ("main" (h 1 "button" ((on click (send inc))) "+"))))
           (component Root (views ("main" (h 2 "div" ((on click (send outer))) (x-render (field child) none))))))))
  (match-define (list div button) (sites classes '(comp Root (child (comp Child)))))
  ;; A component in a field: the update path is the field.
  (test-equal (term (site-info ,button click))
              (term ((on click (send inc)) (((frame none ("child") none #t)) ("child")))))
  (test-equal (term (site-info ,div click)) (term ((on click (send outer)) (() ()))))
  ;; Outer handlers stop at the component boundary.
  (test-equal (term (site-info ,button input)) 'none)
  ;; Loop items inside a component's own view are not component frames.
  (define loop (term ((component Root (views ("main" (each (field xs) (h 1 "button" ((on click (send pick)))) none)))))))
  (test-equal (for/list ([s (sites loop '(comp Root (xs (arr 1 2))))]) (term (site-info ,s click)))
              (term (((on click (send pick)) (((frame none ("xs") 0 #f)) ()))
                     ((on click (send pick)) (((frame none ("xs") 1 #f)) ())))))
  ;; A drop bubbles past a component with no handler for it, to the next
  ;; enclosing one, at the frame of the child it came through.
  (define drops
    (term ((component Child (views ("main" (h 1 "span" () "x"))))
           (component Root (views ("main" (h 2 "ul" ((on drop (send dropped)))
                                             (each (field kids) (render-it none) none))))))))
  (match-define (list _ span0 _) (sites drops '(comp Root (kids (arr (comp Child) (comp Child))))))
  (test-equal (term (site-info ,span0 drop))
              (term ((on drop (send dropped)) (((frame none ("kids") 0 #f)) ()))))
  (test-equal (term (site-info ,span0 click)) 'none)
  ;; Outside any component, nothing routes.
  (test-equal (term (site-info ,(first (term (sites-of ((el 1 "b" none none () ((on click (send x))) ())) () () () #f)))
                               click))
              'none)
  (test-results))
