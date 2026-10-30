#lang racket
;; Bounded model checking, the analog of TLC, for any reduction relation:
;; every configuration reachable from a start, breadth first, so the first
;; violation of an invariant found has a shortest trace. tree/check.rkt and the
;; host scenarios in system/tutuca.rkt use it.
(require redex/reduction-semantics)
(provide limit explore counterexample)

(define limit (make-parameter 50000))

;; The reachable configurations, in breadth-first order, and for each the rule
;; and configuration it was reached from. Remembered, since a scenario is
;; usually checked for several invariants.
(define explored (make-hash))
(define (explore rel c0)
  (match (hash-ref explored (cons rel c0) #f)
    [(cons order parent) (values order parent)]
    [#f (define-values (order parent) (explore* rel c0))
        (hash-set! explored (cons rel c0) (cons order parent))
        (values order parent)]))
(define (explore* rel c0)
  (define parent (make-hash (list (cons c0 #f))))
  (define order
    (let loop ([frontier (list c0)] [seen (list c0)])
      (when (> (hash-count parent) (limit)) (error 'explore "more than ~a configurations" (limit)))
      (define next
        (for*/list ([c frontier] [r (apply-reduction-relation/tag-with-names rel c)]
                    #:unless (hash-has-key? parent (second r)))
          (hash-set! parent (second r) (cons (first r) c))
          (second r)))
      (if (null? next) (reverse seen) (loop next (append (reverse next) seen)))))
  (values order parent))

;; The shortest trace to a configuration that breaks inv, as (rule . config)
;; steps from c0, or #f.
(define (counterexample rel c0 inv)
  (define-values (order parent) (explore rel c0))
  (define bad (findf (λ (c) (not (inv c))) order))
  (and bad
       (let back ([c bad] [trace '()])
         (match (hash-ref parent c)
           [#f (cons (cons "start" c) trace)]
           [(cons rule from) (back from (cons (cons rule c) trace))]))))

