#lang racket
;; Well-formed views: every event binding names a message of the class's
;; protocol, with the arguments it declares (lint's unknown-handler,
;; send-arity and send-arg-type rules, src/lint/index.js).
;;
;; This is what the host relies on when an event's handler must exist
;; (system/host.rkt): for a well-formed registry, routing an event never finds
;; an action whose message the receiving class lacks.
(require redex/reduction-semantics "../component/types.rkt" "../component/class.rkt" "view.rkt")
(provide wf-send wf-registration wf-registry wf?)

;; A send against its message: the handler exists; when the message types its
;; arguments, the arity matches and every constant argument has its type.
(define-judgment-form View
  #:mode (wf-send I I)
  #:contract (wf-send class-def on-attr)
  [(where handler ,(handler-of (term class-def) (term fname_m)))
   (where #t ,(args-ok? (contract-of (term handler) 'args) (term (arg ...))))
   ----------------------- "send"
   (wf-send class-def (on fname_e (send fname_m arg ...)))])

(define (args-ok? types args)
  (match types
    [#f #t]
    [(list ty ...)
     (and (= (length ty) (length args))
          (for/and ([t ty] [a args])
            (or (not (redex-match? View value a)) (valid? t a 'none))))]))

;; Every binding in the class's views, as Collect gathered them.
(define-judgment-form View
  #:mode (wf-registration I)
  #:contract (wf-registration registration)
  [(where (on-attr_b ...) (on-attr ... ...))
   (wf-send class-def on-attr_b) ...
   ----------------------- "registration"
   (wf-registration (reg cname ((tid (on-attr ...)) ...) class-def view-def))])

(define-judgment-form View
  #:mode (wf-registry I)
  #:contract (wf-registry registry)
  [(wf-registration registration) ...
   ----------------------- "registry"
   (wf-registry (registration ...))])

(define (wf? registry) (judgment-holds (wf-registry ,registry)))

(module+ test
  (require rackunit)
  (define (reg . components) (term (register-components ,components)))
  (define button '(views ("main" (h 1 "button" ((on click (send inc 1)))))))
  (test-equal (wf? (reg `(component C ,button (on (inc (by) (step)))))) #t)
  ;; unknown-handler: no own handler on.inc.
  (test-equal (wf? (reg `(component C ,button (on)))) #f)
  ;; send-arity, when the message types its arguments.
  (test-equal (wf? (reg `(component C ,button (on (inc (a b) (args Number Number) (step)))))) #f)
  (test-equal (wf? (reg `(component C ,button (on (inc (a b) (step)))))) #t)
  ;; send-arg-type: constants against their declared types; computed arguments
  ;; are only known on dispatch.
  (test-equal (wf? (reg `(component C ,button (on (inc (a) (args String) (step)))))) #f)
  (test-equal (wf? (reg '(component C (views ("main" (h 1 "input" ((on input (send set (target-value)))))))
                                    (on (set (v) (args String) (step))))))
              #t)
  (test-results))
