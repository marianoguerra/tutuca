#lang racket
;; M6, swapping: a handler's transition can be (swap mk), replacing its
;; receiver, in its parent's slot (or as the host's root), with a new instance
;; of the same kind or of another. Until now only a parent could replace a
;; child; now a component replaces itself, so the instance that sent a message
;; can be gone from a place that never changed.
;;
;; The swap replaces the receiver's draft: what the handler set before it is
;; dropped with the old instance (copy it with (new k (g (get g)))), and what
;; it does after applies to the new one. The commit writes the new instance in
;; the old one's place. Effects are still sent from the old instance's address,
;; and a send-at's relative path starts from the new one.
;;
;; Same kind (M6a): by-identity observes a response to the old instance
;; orphaned; by-path delivers it to the new one, which breaks P3, though the new
;; one has the handler. Another kind (M6b): by-path delivers it to an instance
;; that may have no handler for it: ignored, which breaks P6.
;;
;; Open question, not modeled: should a swap forward the messages in flight to
;; the old instance to the new one? That is a policy that maps identities
;; through swaps, between by-identity (drop) and by-path (deliver anyway).
(require redex/reduction-semantics "engine.rkt" (only-in "reorder.rkt" Reorder reorder-tier reorder->))
(provide Swap swap-tier swap-> make-config own-clauses (all-defined-out))

(define-extended-language Swap Reorder
  (act ::= .... (swap mk)))

(define-tier swap-tier Swap #:extends reorder-tier #:relation swap->
  [acts
   [(acts ((swap mk) act ...) c_0 env K ν) (acts (act ...) c env K ν_1)
    (where (c ν_1) (make-new K mk c_0 env ν))]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals swap-> c))))
  (define (holds c invs)
    (for ([inv invs]) (check-false (counterexample swap-> c inv) (format "~a" (object-name inv)))))
  (define (breaks? c inv) (and (counterexample swap-> c inv) #t))
  (define (fate? c head)
    (for*/or ([f (finals swap-> c)] [o (config-obs f)]) (eq? (car o) head)))

  ;; A card asks for something, and can turn into a fresh card (same kind) or
  ;; into a note (another kind, with no handler for the answer).
  (define card
    '(kind Card (state (label 10))
           ()
           ((on (send go) () ((request fetch)))
            (on (ok fetch) (x) ((log (+ (get label) x))))
            (on (send renew) () ((set label 99) (swap (new Card (label 20)))))
            (on (send to-note) () ((swap (new Note))))
            (on (send renew-and-poke) () ((swap (new Card (label 30))) (send-at () poke)))
            (on (send poke) () ((log (get label)))))))
  (define note '(kind Note (state) () ()))
  (define deck
    '(kind Deck (state)
           ((cards (list)))
           ((on (send push) () ((append cards (new Card))))
            (on (request fetch) () ((answer ok 100))))))
  (define (scenario events #:policy [p 'by-path])
    (make-config #:kinds (list card note deck) #:root 'Deck #:events events #:policy p))
  (check-exn #rx"not in domain" (λ () (apply-reduction-relation reorder-> (scenario '((ev () push))))))

  ;; M6a: the asker turns into a fresh card while its request is in flight.
  ;; The set before the swap is dropped: the new card's label is 20, not 99.
  (define renewing '((ev () push) (ev ((index cards 0)) go) (ev ((index cards 0)) renew)))
  (check-equal? (outcomes (scenario renewing)) (set '(110) '(120)))
  (check-true (breaks? (scenario renewing) p3-sound))
  (holds (scenario renewing #:policy 'by-identity) (list p1-identity p2-exactly-once p3-sound p6-protocol))
  (check-equal? (outcomes (scenario renewing #:policy 'by-identity)) (set '(110) '()))
  (check-true (fate? (scenario renewing #:policy 'by-identity) 'orphaned))
  (check-true (fate? (scenario renewing #:policy 'by-path-checked) 'stale))

  ;; M6b: the asker turns into a note. by-path delivers the response to the
  ;; note, which ignores it: P6 breaks. by-identity orphans it instead.
  (define noting '((ev () push) (ev ((index cards 0)) go) (ev ((index cards 0)) to-note)))
  (check-true (breaks? (scenario noting) p6-protocol))
  (check-true (breaks? (scenario noting) p3-sound))
  (holds (scenario noting #:policy 'by-identity) (list p2-exactly-once p3-sound p6-protocol))

  ;; A send-at () after a swap reaches the new instance, from the old one's
  ;; address: its relative path starts at the committed tree.
  (check-equal? (outcomes (scenario '((ev () push) (ev ((index cards 0)) renew-and-poke)))) (set '(30)))
  (holds (scenario '((ev () push) (ev ((index cards 0)) renew-and-poke)) #:policy 'by-identity)
         (list p1-identity p3-sound))

  ;; The root can swap too, in the same transaction that notifies the host. By
  ;; path, the notification bubbles from the root's place and the host's reply
  ;; reaches the new root. By identity, the notification's sender is gone
  ;; before it bubbles: it is orphaned, and the host never hears of it.
  (define root
    '(kind Root (state (label 1))
           ()
           ((on (send go) () ((notify hello) (swap (new Root (label 2)))))
            (on (send hi) () ((log (get label)))))))
  (define replying '(host ((on (notify hello) () ((reply hi) stop)))))
  (define (rooted p) (make-config #:kinds (list root) #:root 'Root #:host replying
                                  #:events '((ev () go)) #:policy p))
  (check-equal? (outcomes (rooted 'by-path)) (set '(2)))
  (check-equal? (outcomes (rooted 'by-identity)) (set '())))
