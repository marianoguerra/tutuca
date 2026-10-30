#lang racket
;; Bounded model checking, the analog of TLC: every configuration reachable
;; from a scenario, breadth first, so the first violation found has a shortest
;; trace. Invariants are predicates on configurations; the properties of the
;; README are below, read off the tree and the observations.
(require (except-in redex/reduction-semantics counterexample) "engine.rkt" "../explore.rkt")
(provide limit explore finals counterexample show-trace policies-agree?
         p1-identity p2-exactly-once p3-sound p6-protocol p7-hops)

;; The configurations nothing more can happen in.
(define (finals rel c0)
  (define-values (order _) (explore rel c0))
  (filter quiescent? order))

;; A trace, one line per step: the rule and the observations it added.
(define (show-trace trace)
  (for/fold ([seen 0]) ([step trace])
    (define obs (config-obs (cdr step)))
    (printf "~a\n" (car step))
    (for ([o (drop obs seen)]) (printf "    ~s\n" o))
    (length obs))
  (void))

;; Under every policy, the same final observations: while nothing moves, the
;; policies can't be told apart.
(define (policies-agree? rel make policies)
  (define (outcomes p) (list->set (map config-obs (finals rel (make p)))))
  (define first-outcomes (outcomes (car policies)))
  (for/and ([p (cdr policies)]) (equal? (outcomes p) first-outcomes)))

(define (obs-of c head) (filter (λ (o) (eq? (car o) head)) (config-obs c)))

;; P1: no two instances in the tree share an identity.
(define (p1-identity c)
  (not (check-duplicates (tree-ids (config-tree c)))))

;; P2: a request is answered at most once, and once nothing is left to happen,
;; it has exactly one outcome: its response delivered, orphaned or stale, or
;; the request itself orphaned or stale before it bubbled, or lost on the way.
(define (p2-exactly-once c)
  (define answered (map second (obs-of c 'answered)))
  (and (not (check-duplicates answered))
       (or (not (quiescent? c))
           (for/and ([req (obs-of c 'requested)])
             (= 1 (for/sum ([o (config-obs c)])
                    (match o
                      [`(,(or 'deliver 'orphaned 'stale 'lost) (,(or 'response 'request) ,ρ . ,_) . ,_)
                       #:when (equal? ρ (second req)) 1]
                      [_ 0])))))))

;; P3: every delivered message reaches the instance its address recorded.
(define (p3-sound c)
  (for/and ([o (obs-of c 'deliver)]) (equal? (fourth o) (fifth o))))

;; P6: every delivered response finds a handler in its receiver, in the state
;; the receiver is in now. (An ignored env event or reply is the program's
;; choice; a response is what its requester asked for.)
(define (p6-protocol c)
  (for/and ([o (obs-of c 'ignored)]) (not (match (second o) [`(response . ,_) #t] [_ #f]))))

;; P7: every hop of a bubble visits the ancestor it was expected to (the
;; sender's, when the bubble started), and no bubble is lost on the way.
(define (p7-hops c)
  (and (null? (obs-of c 'lost))
       (for/and ([o (obs-of c 'hop)]) (equal? (fourth o) (fifth o)))))
