#lang racket
;; M3, clearing: an item of a collection can be cleared, (clear f i), leaving
;; a tombstone. Its place is never reused (add-key refuses a cleared key), so
;; the positions of the other items don't change, and a path never reaches an
;; instance other than the one it was recorded for.
;;
;; What changes is that a recorded address can now reach nothing: a message to
;; a cleared item is orphaned, under every policy alike. Within a turn, hops
;; still can't be cleared under a bubble (a hop only changes what is below it,
;; so a parent clearing the sender doesn't stop the bubble). Hop by hop
;; (per-hop), an ancestor can be cleared between two hops, and the rest of the
;; bubble is lost: the first property, P7, that only the turn semantics keeps.
(require redex/reduction-semantics "engine.rkt" (only-in "grow.rkt" Grow grow-tier grow->))
(provide Clear clear-tier clear-> make-config own-clauses (all-defined-out))

(define-extended-language Clear Grow
  (item ::= .... cleared)
  (act ::= .... (clear f e)))

(define-tier clear-tier Clear #:extends grow-tier #:relation clear->
  ;; an item of collection f, by index or key
  [slot-step
   [(slot-step c f v) (index f v) (where (list any ...) (slot-of c f))]
   [(slot-step c f v) (key f v) (where (map any ...) (slot-of c f))]]
  [acts
   [(acts ((clear f e) act ...) self env K ν) (acts (act ...) (item-set self step cleared) env K ν)
    (where step (slot-step self f (eval e self env)))
    (where c (item-at self step))]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes rel c) (list->set (map logs (finals rel c))))
  (define all-policies '(by-path by-path-checked by-identity))
  (define props (list p1-identity p2-exactly-once p3-sound p7-hops))
  (define (holds rel c invs)
    (for ([inv invs]) (check-false (counterexample rel c inv) (format "~a" (object-name inv)))))

  (define item
    '(kind Item (state (label 0))
           ()
           ((on (send go) () ((request fetch (get label))))
            (on (ok fetch) (x) ((log x)))
            (on (send bye) () ((notify close (get label))))
            (on (send ping-me) () ((notify ping))))))
  (define items
    '(kind Items (state (count 0))
           ((items (list)))
           ((on (send push) () ((set count (+ (get count) 1)) (append items (new Item (label (get count))))))
            (on (send drop) (i) ((clear items i)))
            (on (request fetch) (l) ((answer ok (+ l 100))))
            ;; label i is the item at i - 1: clear it, and let the host know
            (on (notify close) (i) ((clear items (- i 1)) (log "closed"))))))
  (define host '(host ((on (notify close) (i) ((log "host") stop)))))
  (define (scenario events #:policy [p 'by-path] #:gran [g 'turn])
    (make-config #:kinds (list item items) #:root 'Items #:host host #:events events
                 #:policy p #:gran g))

  ;; The grammar is the tower: grow's relation doesn't take a program that
  ;; clears.
  (check-exn #rx"not in domain" (λ () (apply-reduction-relation grow-> (scenario '((ev () drop 0))))))

  ;; A request in flight while its asker is cleared: the response is delivered,
  ;; or orphaned if the clear came first. Every policy does the same.
  (define racing '((ev () push) (ev () push) (ev ((index items 0)) go) (ev () drop 0)))
  (check-equal? (outcomes clear-> (scenario racing)) (set '(101) '()))
  ;; Orphaned either way it can be: the request, cleared before it bubbled, or
  ;; its response, cleared before it arrived.
  (check-equal? (for*/set ([c (finals clear-> (scenario racing))] [o (config-obs c)]
                           #:when (eq? (car o) 'orphaned))
                  (car (second o)))
                (set 'request 'response))
  (for ([p all-policies]) (holds clear-> (scenario racing #:policy p) props))
  (check-true (policies-agree? clear-> (λ (p) (scenario racing #:policy p)) all-policies))

  ;; A parent clears the child that notified it, and the notification goes on
  ;; to the host: the hops above the sender don't move.
  (define closing '((ev () push) (ev ((index items 0)) bye)))
  (check-equal? (outcomes clear-> (scenario closing)) (set '("closed" "host")))
  (holds clear-> (scenario closing) props)

  ;; Hop by hop, an ancestor can be cleared between two hops. A board of
  ;; groups, each holding one item: the item's ping passes its group and is
  ;; logged by the board, unless the group is cleared before the second hop.
  (define group '(kind Group (state) ((item (new Item))) ()))
  (define board
    '(kind Board (state)
           ((groups (list)))
           ((on (send push) () ((append groups (new Group))))
            (on (send drop) (i) ((clear groups i)))
            (on (notify ping) () ((log "ping") stop)))))
  (define (boarded g #:policy [p 'by-path])
    (make-config #:kinds (list item group board) #:root 'Board #:policy p #:gran g
                 #:events '((ev () push) (ev ((index groups 0) (field item)) ping-me) (ev () drop 0))))
  (for ([p all-policies])
    (holds clear-> (boarded 'turn #:policy p) props)
    (check-false (counterexample clear-> (boarded 'per-hop #:policy p) p3-sound))
    (define trace (counterexample clear-> (boarded 'per-hop #:policy p) p7-hops))
    (check-true (and trace #t) (format "per-hop ~a loses a bubble" p))
    (when trace
      (check-match (config-obs (cdr (last trace))) (list _ ... `(lost notify ping ,_) _ ...))))
  (check-equal? (outcomes clear-> (boarded 'turn)) (set '("ping") '()))
  (check-equal? (outcomes clear-> (boarded 'per-hop)) (set '("ping") '())))
