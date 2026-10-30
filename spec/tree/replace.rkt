#lang racket
;; M4, replacing: an item's place can get a new instance, (put f i mk), whether
;; the item was cleared or is still there, and so can a field, (put-field f mk).
;;
;; Now a path can reach an instance other than the one it was recorded for, and
;; the policies part ways. by-path delivers to whatever is at the path, which
;; breaks P3: a response, a reply or a send-at reaches the replacement.
;; by-path-checked sees the identity changed and observes the message stale;
;; by-identity looks for the instance, which is gone, and observes it orphaned.
;; Neither misdelivers. Urgency doesn't help: the tree changes between the
;; request and the response's arrival, not after it.
(require redex/reduction-semantics "engine.rkt" (only-in "clear.rkt" Clear clear-tier clear->))
(provide Replace replace-tier replace-> make-config own-clauses (all-defined-out))

(define-extended-language Replace Clear
  (act ::= .... (put f e mk) (put-field f mk)))

(define-tier replace-tier Replace #:extends clear-tier #:relation replace->
  [exists
   [(exists none) #f]
   [(exists any) #t]]
  [acts
   [(acts ((put f e mk) act ...) self env K ν) (acts (act ...) (item-set self step c) env K ν_1)
    (where step (slot-step self f (eval e self env)))
    (where #t (exists (item-at self step)))
    (where (c ν_1) (make-new K mk self env ν))]
   [(acts ((put-field f mk) act ...) self env K ν) (acts (act ...) (slot-set self f c) env K ν_1)
    (where c_0 (slot-of self f))
    (where (c ν_1) (make-new K mk self env ν))]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals replace-> c))))
  (define (holds c invs)
    (for ([inv invs]) (check-false (counterexample replace-> c inv) (format "~a" (object-name inv)))))
  (define (fate c head)
    (for*/or ([f (finals replace-> c)] [o (config-obs f)]) (eq? (car o) head)))

  ;; An item logs its label with what it gets back, so a misdelivery shows.
  (define item
    '(kind Item (state (label 0))
           ()
           ((on (send go) () ((request fetch)))
            (on (ok fetch) (x) ((log (+ (get label) x))))
            (on (send poke) () ((log (get label)))))))
  (define items
    '(kind Items (state)
           ((items (list)) (main (new Item (label 50))))
           ((on (send push) () ((append items (new Item (label 10)))))
            (on (send renew) (i) ((put items i (new Item (label 20)))))
            (on (send renew-main) () ((put-field main (new Item (label 60)))))
            (on (send poke-later) () ((send-at ((index items 0)) poke)))
            (on (request fetch) () ((answer ok 100))))))
  (define (scenario events #:policy [p 'by-path] #:item [it item])
    (make-config #:kinds (list it items) #:root 'Items #:events events #:policy p))
  (check-exn #rx"not in domain" (λ () (apply-reduction-relation clear-> (scenario '((ev () renew 0))))))

  ;; A request in flight while its asker's place gets a new item.
  (define racing '((ev () push) (ev ((index items 0)) go) (ev () renew 0)))
  ;; by-path: the replacement gets the response (20 + 100): P3 breaks.
  (check-equal? (outcomes (scenario racing)) (set '(110) '(120)))
  (let ([trace (counterexample replace-> (scenario racing) p3-sound)])
    (check-true (and trace #t))
    (check-match (config-obs (cdr (last trace))) (list _ ... `(deliver (response . ,_) fetch 2 ,(not 2)) _ ...)))
  ;; by-path-checked: stale; by-identity: orphaned. Neither misdelivers.
  (holds (scenario racing #:policy 'by-path-checked) (list p1-identity p2-exactly-once p3-sound))
  (check-true (fate (scenario racing #:policy 'by-path-checked) 'stale))
  (holds (scenario racing #:policy 'by-identity) (list p1-identity p2-exactly-once p3-sound))
  (check-true (fate (scenario racing #:policy 'by-identity) 'orphaned))
  (check-false (fate (scenario racing #:policy 'by-identity) 'stale))
  (for ([p '(by-path-checked by-identity)])
    (check-equal? (outcomes (scenario racing #:policy p)) (set '(110) '())))

  ;; An urgent response doesn't help: the place changed before it arrived.
  (define urgent-item
    '(kind Item (state (label 0))
           ()
           ((on (send go) () ((request/urgent fetch)))
            (on (ok fetch) (x) ((log (+ (get label) x)))))))
  (check-true (and (counterexample replace-> (scenario racing #:item urgent-item) p3-sound) #t))

  ;; A send-at waits in the queue while its target's place is renewed: by-path
  ;; pokes the new item, the others don't poke anything.
  (define poking '((ev () push) (ev () poke-later) (ev () renew 0)))
  (check-equal? (outcomes (scenario poking)) (set '(10) '(20)))
  (check-true (and (counterexample replace-> (scenario poking) p3-sound) #t))
  (check-equal? (outcomes (scenario poking #:policy 'by-identity)) (set '(10) '()))
  (check-false (counterexample replace-> (scenario poking #:policy 'by-path-checked) p3-sound))

  ;; A field is replaced the same way.
  (define main-racing '((ev ((field main)) go) (ev () renew-main)))
  (check-equal? (outcomes (scenario main-racing)) (set '(150) '(160)))
  (check-equal? (outcomes (scenario main-racing #:policy 'by-identity)) (set '(150) '())))
