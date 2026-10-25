#lang racket
;; Routing on the semantic tree: which handler an event on an element runs,
;; and the route of the component that runs it.
;;
;; This is the meaning bind/decode.rkt implements over the DOM. Here nothing is
;; scanned: an element's dispatch path is the frames of the wrappers above it,
;; a component wrapper making the frame before it a component frame, and its
;; candidate handlers are its own, then those of the elements above it, up to
;; the nearest component wrapper.
(require redex/reduction-semantics "../component/paths.rkt" "sem.rkt" "view.rkt")
(provide Sites sites-of sites-in site-info)

(define-extended-language Sites View
  ;; One element in document order: the handler lists from it outwards to the
  ;; nearest component, its dispatch path, and whether a component encloses it.
  (site ::= (elem ((on-attr ...) ...) dpath boolean)))

(define-metafunction Sites
  sites-of : (snode ...) ((on-attr ...) ...) dpath boolean -> (site ...)
  [(sites-of () any_hs dpath boolean) ()]
  [(sites-of (snode_0 snode ...) any_hs dpath boolean)
   (site_0 ... site ...)
   (where (site_0 ...) (sites-in snode_0 any_hs dpath boolean))
   (where (site ...) (sites-of (snode ...) any_hs dpath boolean))])

(define-metafunction Sites
  sites-in : snode ((on-attr ...) ...) dpath boolean -> (site ...)
  [(sites-in (el tid tag ns? key? (prop ...) (on-attr ...) (snode ...)) (any_h ...) dpath boolean)
   ((elem ((on-attr ...) any_h ...) dpath boolean) site_c ...)
   (where (site_c ...) (sites-of (snode ...) ((on-attr ...) any_h ...) dpath boolean))]
  [(sites-in (component cname (snode ...)) any_hs dpath boolean)
   (sites-of (snode ...) () (promote dpath) #t)]
  [(sites-in (enter dframe (snode ...)) any_hs (dframe_p ...) boolean)
   (sites-of (snode ...) any_hs (dframe_p ... dframe) boolean)]
  [(sites-in (items (item key? dframe (snode ...)) ...) any_hs dpath boolean)
   (site ... ...)
   (where ((site ...) ...) ((sites-in (enter dframe (snode ...)) any_hs dpath boolean) ...))]
  [(sites-in (group key? (snode ...)) any_hs dpath boolean) (sites-of (snode ...) any_hs dpath boolean)]
  [(sites-in snode any_hs dpath boolean) ()])

;; The first handler for the event's type, innermost element first, with the
;; route it runs at; none outside any component.
(define-metafunction Sites
  site-info : site fname -> any
  [(site-info (elem any_hs dpath #f) fname) none]
  [(site-info (elem ((on-attr ...) ...) dpath #t) fname)
   ,(or (for/first ([h (term (on-attr ... ...))] #:when (eq? (second h) (term fname)))
          (list h (term (dpath (to-update-path dpath)))))
        'none)])

(module+ test
  (require rackunit)
  (define (sites classes root)
    (term (sites-of (render-root (register-components ,classes) ,root) () () #f)))
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
  ;; Outside any component, nothing routes.
  (test-equal (term (site-info ,(first (term (sites-of ((el 1 "b" none none () ((on click (send x))) ())) () () #f)))
                               click))
              'none)
  (test-results))
