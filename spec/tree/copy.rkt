#lang racket
;; M8, copying: a new instance can be a copy of one in the tree. Two forms of
;; mk, wherever a new instance goes (append, add-key, put, put-field, insert,
;; prepend, swap):
;;   (copy pp)   the instance at pp, relative to the receiver, as it is in the
;;               receiver's draft, every instance in it given a fresh identity
;;   (share pp)  the same instance, identities and all: copying a value without
;;               minting, which is what copying an immutable tree does for free
;;
;; A share breaks P1 as soon as it is made: two instances in the tree have the
;; same identity. Then identity no longer tells them apart. P3 holds, because it
;; compares identities, and misses that the message went to the other one:
;; by-path-checked delivers a response to whichever one is at the recorded
;; path, by-identity to whichever one locate finds first. Both misdeliver when
;; the share is prepended before the original. With copy, P1 holds and the
;; policies behave as in M5: by-path-checked observes the response stale,
;; by-identity delivers it to the original where it moved.
(require redex/reduction-semantics "engine.rkt" (only-in "fsm.rkt" Fsm fsm-tier fsm->))
(provide Copy copy-tier copy-> make-config own-clauses (all-defined-out))

(define-extended-language Copy Fsm
  (mk ::= .... (copy pp) (share pp)))

(define-tier copy-tier Copy #:extends fsm-tier #:relation copy->
  [make-new
   [(make-new K (copy pp) self env ν) (fresh c ν) (where c (source self pp env))]
   [(make-new K (share pp) self env ν) (c ν) (where c (source self pp env))]]
  ;; the instance a written path reaches from the receiver's draft
  [source
   [(source c_0 (pstep ...) env) c
    (where π (concretize-path c_0 ((eval-step pstep c_0 env) ...)))
    (where c (node-at c_0 π))]]
  ;; A copy with a fresh identity for every instance in it, outermost first,
  ;; and the next fresh id. Locals, keys and a control state are kept.
  [fresh
   [(fresh (comp k ι any_l (any_s ...) any_q ...) ν) ((comp k ν any_l (any_t ...) any_q ...) ν_1)
    (where ((any_t ...) ν_1) (fresh-entries (any_s ...) ,(add1 (term ν))))]
   [(fresh (list any ...) ν) ((list any_1 ...) ν_1) (where ((any_1 ...) ν_1) (fresh-each (any ...) ν))]
   [(fresh (map any ...) ν) ((map any_1 ...) ν_1) (where ((any_1 ...) ν_1) (fresh-entries (any ...) ν))]
   [(fresh any ν) (any ν)]]
  [fresh-each
   [(fresh-each () ν) (() ν)]
   [(fresh-each (any_0 any ...) ν) ((any_x any_y ...) ν_2)
    (where (any_x ν_1) (fresh any_0 ν))
    (where ((any_y ...) ν_2) (fresh-each (any ...) ν_1))]]
  ;; a slot's or a map's entries: (name value), the values copied
  [fresh-entries
   [(fresh-entries () ν) (() ν)]
   [(fresh-entries ((any_k any_v) any ...) ν) (((any_k any_x) any_y ...) ν_2)
    (where (any_x ν_1) (fresh any_v ν))
    (where ((any_y ...) ν_2) (fresh-entries (any ...) ν_1))]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals copy-> c))))
  (define (holds c invs)
    (for ([inv invs]) (check-false (counterexample copy-> c inv) (format "~a" (object-name inv)))))
  (define (breaks? c inv) (and (counterexample copy-> c inv) #t))
  (define (fate? c head)
    (for*/or ([f (finals copy-> c)] [o (config-obs f)]) (eq? (car o) head)))

  ;; Every instance in a copy is new, at any depth; locals, keys, tombstones and
  ;; control states stay.
  (check-equal?
   (term (fresh (comp A 1 ((n 5))
                      ((one (comp B 2 () () idle))
                       (xs (list (comp B 3 () ()) cleared))
                       (m (map ("a" (comp B 4 () ()))))))
                10))
   '((comp A 10 ((n 5))
           ((one (comp B 11 () () idle))
            (xs (list (comp B 12 () ()) cleared))
            (m (map ("a" (comp B 13 () ()))))))
     14))

  ;; An item asks for something and logs its label with the answer, so which
  ;; one got the answer shows. The list puts a copy or a share of its first
  ;; item before it.
  (define item
    '(kind Item (state (label 10))
           ()
           ((on (send go) () ((request fetch)))
            (on (ok fetch) (x) ((log (+ (get label) x))))
            (on (send rename) (l) ((set label l))))))
  (define items
    '(kind Items (state)
           ((items (list)))
           ((on (send push) () ((append items (new Item))))
            (on (send copy-first) () ((prepend items (copy ((index items 0))))))
            (on (send share-first) () ((prepend items (share ((index items 0))))))
            (on (request fetch) () ((answer ok 100))))))
  (define (scenario events #:policy [p 'by-path-checked])
    (make-config #:kinds (list item items) #:root 'Items #:events events #:policy p))
  (check-exn #rx"not in domain"
             (λ () (apply-reduction-relation fsm-> (scenario '((ev () push) (ev () copy-first))))))
  ;; The request is in flight while the copy or share is put first and renamed.
  (define (racing how) `((ev () push) (ev ((index items 0)) go) (ev () ,how) (ev ((index items 0)) rename 20)))

  ;; share: P1 breaks at once, and P3, blind to it, holds while every policy
  ;; gives the answer to the share (20 + 100).
  (for ([p '(by-path by-path-checked by-identity anchored)])
    (check-true (breaks? (scenario (racing 'share-first) #:policy p) p1-identity))
    (check-false (counterexample copy-> (scenario (racing 'share-first) #:policy p) p3-sound))
    (check-equal? (outcomes (scenario (racing 'share-first) #:policy p)) (set '(110) '(120))))

  ;; copy: P1 holds, and no answer reaches the copy. by-path-checked: stale;
  ;; by-identity: always the original, where it moved.
  (for ([p '(by-path-checked by-identity)])
    (holds (scenario (racing 'copy-first) #:policy p) (list p1-identity p2-exactly-once p3-sound)))
  (check-equal? (outcomes (scenario (racing 'copy-first))) (set '(110) '()))
  (check-true (fate? (scenario (racing 'copy-first)) 'stale))
  (check-equal? (outcomes (scenario (racing 'copy-first) #:policy 'by-identity)) (set '(110)))
  (check-equal? (outcomes (scenario (racing 'copy-first) #:policy 'anchored)) (set '(110)))
  ;; by-path is as in M5: the copy moved into the asker's index, and gets its answer.
  (check-equal? (outcomes (scenario (racing 'copy-first) #:policy 'by-path)) (set '(110) '(120)))
  (check-true (breaks? (scenario (racing 'copy-first) #:policy 'by-path) p3-sound))

  ;; A copy is a copy: renaming it leaves the original as it was.
  (check-equal? (outcomes (scenario '((ev () push) (ev () copy-first) (ev ((index items 0)) rename 20)
                                      (ev ((index items 1)) go))))
                (set '(110)))

  ;; The children of what's copied are new too: a pair holding an item.
  (define pair '(kind Pair (state) ((inner (new Item))) ()))
  (define pairs
    '(kind Pairs (state)
           ((pairs (list)))
           ((on (send push) () ((append pairs (new Pair))))
            (on (send copy-last) () ((append pairs (copy ((index pairs (- (len pairs) 1)))))))
            (on (send share-last) () ((append pairs (share ((index pairs (- (len pairs) 1))))))))))
  (define (paired how)
    (make-config #:kinds (list item pair pairs) #:root 'Pairs #:events `((ev () push) (ev () ,how))))
  (check-false (counterexample copy-> (paired 'copy-last) p1-identity))
  (check-true (breaks? (paired 'share-last) p1-identity)))
