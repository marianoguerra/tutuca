#lang racket
;; M5, reordering: a list can be prepended to, (prepend f mk), or inserted into,
;; (insert f i mk), which shifts the items after it. An instance now outlives
;; its path: it is still there, at another index.
;;
;; by-path delivers to whatever moved into the old index, breaking P3.
;; by-path-checked refuses it as stale, though the receiver still exists.
;; by-identity finds it where it moved: the only policy so far that delivers
;; every message to its receiver whenever the receiver exists.
;;
;; The tier adds a fourth policy, anchored: find a send-at's sender by identity
;; and apply its relative path again from there. It means "my child items[0]",
;; not "that instance", and after a prepend it reaches the new first item.
;; Messages without a relative path (replies, responses, bubbles) resolve as
;; by-identity.
(require redex/reduction-semantics "engine.rkt" (only-in "replace.rkt" Replace replace-tier replace->))
(provide Reorder reorder-tier reorder-> make-config own-clauses (all-defined-out))

(define-extended-language Reorder Replace
  (policy ::= .... anchored)
  (act ::= .... (prepend f mk) (insert f e mk)))

(define-tier reorder-tier Reorder #:extends replace-tier #:relation reorder->
  [insert-at
   [(insert-at (any ...) 0 any_x) (any_x any ...)]
   [(insert-at (any_0 any ...) natural any_x) (any_0 any_1 ...)
    (side-condition (> (term natural) 0))
    (where (any_1 ...) (insert-at (any ...) ,(sub1 (term natural)) any_x))]]
  [acts
   [(acts ((prepend f mk) act ...) self env K ν) (acts ((insert f 0 mk) act ...) self env K ν)]
   [(acts ((insert f e mk) act ...) self env K ν) (acts (act ...) (slot-set self f (list any_1 ...)) env K ν_1)
    (where (list any ...) (slot-of self f))
    (where (c ν_1) (make-new K mk self env ν))
    (where (any_1 ...) (insert-at (any ...) (eval e self env) c))]]
  ;; anchored: the sender, found by identity, then the relative path from there
  [resolve
   [(resolve anchored c (at π ι ι_1 (step ...))) (found (step_1 ... step ...) c_1)
    (where (step_1 ...) (locate c ι_1))
    (where c_1 (node-at c (step_1 ... step ...)))]
   [(resolve anchored c (at π ι ι_1 π_1)) orphaned]
   [(resolve anchored c addr) (resolve by-identity c addr)]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals reorder-> c))))
  (define (holds c invs)
    (for ([inv invs]) (check-false (counterexample reorder-> c inv) (format "~a" (object-name inv)))))
  (define (fate? c head)
    (for*/or ([f (finals reorder-> c)] [o (config-obs f)]) (eq? (car o) head)))

  (define item
    '(kind Item (state (label 0))
           ()
           ((on (send go) () ((request fetch)))
            (on (ok fetch) (x) ((log (+ (get label) x))))
            (on (send poke) () ((log (get label)))))))
  (define items
    '(kind Items (state)
           ((items (list)))
           ((on (send push) () ((append items (new Item (label 10)))))
            (on (send unshift) () ((prepend items (new Item (label 20)))))
            (on (send squeeze) (i) ((insert items i (new Item (label 30)))))
            (on (send poke-first) () ((send-at ((index items 0)) poke)))
            (on (request fetch) () ((answer ok 100))))))
  (define (scenario events #:policy [p 'by-path])
    (make-config #:kinds (list item items) #:root 'Items #:events events #:policy p))
  (check-exn #rx"not in domain" (λ () (apply-reduction-relation replace-> (scenario '((ev () unshift))))))

  ;; A request in flight while an item is put before its asker.
  (define racing '((ev () push) (ev ((index items 0)) go) (ev () unshift)))
  ;; by-path: the response goes to the new first item (20 + 100).
  (check-equal? (outcomes (scenario racing)) (set '(110) '(120)))
  (check-true (and (counterexample reorder-> (scenario racing) p3-sound) #t))
  ;; by-path-checked: stale, though the asker is still there, at index 1.
  (holds (scenario racing #:policy 'by-path-checked) (list p1-identity p2-exactly-once p3-sound))
  (check-equal? (outcomes (scenario racing #:policy 'by-path-checked)) (set '(110) '()))
  (check-true (fate? (scenario racing #:policy 'by-path-checked) 'stale))
  ;; by-identity: always delivered, to the asker.
  (holds (scenario racing #:policy 'by-identity) (list p1-identity p2-exactly-once p3-sound p7-hops))
  (check-equal? (outcomes (scenario racing #:policy 'by-identity)) (set '(110)))
  ;; anchored: a response has no relative path, so it is by-identity.
  (check-equal? (outcomes (scenario racing #:policy 'anchored)) (set '(110)))

  ;; Inserting after the asker moves nothing it holds.
  (define after '((ev () push) (ev ((index items 0)) go) (ev () squeeze 1)))
  (for ([p '(by-path by-path-checked by-identity anchored)])
    (holds (scenario after #:policy p) (list p1-identity p2-exactly-once p3-sound))
    (check-equal? (outcomes (scenario after #:policy p)) (set '(110))))

  ;; A send-at to items[0] waits in the queue while an item is prepended. Two
  ;; meanings: by-identity pokes the item that was first (10), anchored pokes
  ;; whatever is first now (20), which breaks P3 by design.
  (define poking '((ev () push) (ev () poke-first) (ev () unshift)))
  (check-equal? (outcomes (scenario poking #:policy 'by-identity)) (set '(10)))
  (check-equal? (outcomes (scenario poking #:policy 'anchored)) (set '(10) '(20)))
  (check-false (counterexample reorder-> (scenario poking #:policy 'by-identity) p3-sound))
  (check-true (and (counterexample reorder-> (scenario poking #:policy 'anchored) p3-sound) #t)))
