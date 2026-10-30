#lang racket
;; M1, fields: a component holds children in named fields, fixed for its life.
;;
;; Paths get their first step, (field f). Bubbles now pass through ancestors,
;; which can answer, stop, pass, and reply to the sender at any hop. send-at
;; reaches down through fields. Fields never change, so no path can move, and
;; every policy delivers every message where it was meant to go.
(require redex/reduction-semantics "engine.rkt" (only-in "core.rkt" Core core-tier tree->))
(provide Fields fields-tier fields-> make-config own-clauses (all-defined-out))

(define-extended-language Fields Core
  (sval ::= .... c)
  (step ::= .... (field f))
  (pstep ::= .... (field f))
  (mk ::= (new k (g e) ...))
  (snew ::= .... mk))

(define-tier fields-tier Fields #:extends core-tier #:relation fields->
  [slot-of
   [(slot-of (comp k ι any_l (any_1 ... (f any_v) any_2 ...) any ...) f) any_v]
   [(slot-of any_1 any_2) none]]
  [slot-set
   [(slot-set (comp k ι any_l (any_1 ... (f any_0) any_2 ...) any ...) f any_v)
    (comp k ι any_l (any_1 ... (f any_v) any_2 ...) any ...)]]
  [child-at
   [(child-at c_1 (field f)) c (where c (slot-of c_1 f))]]
  [put-child
   [(put-child c_1 (field f) c) (slot-set c_1 f c)]]
  [slot-children
   [(slot-children ((f c) any ...)) (((field f) c) any_1 ...) (where (any_1 ...) (slot-children (any ...)))]]
  [concretize
   [(concretize c_1 (field f)) (field f) (where c (child-at c_1 (field f)))]]
  [make-slots
   [(make-slots K ((f snew) any ...) ν) (((f any_v) any_s ...) ν_2)
    (where (any_v ν_1) (make-slot K snew ν))
    (where ((any_s ...) ν_2) (make-slots K (any ...) ν_1))]]
  [make-slot
   [(make-slot K (new k (g e) ...) ν) (make K k ((g (eval e host ())) ...) ν)]]
  ;; (new k (g e) ...) written in a handler: its locals read the receiver
  [make-new
   [(make-new K (new k (g e) ...) self env ν) (make K k ((g (eval e self env)) ...) ν)]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals fields-> c))))

  (define counter
    '(kind Counter (state (n 0))
           ()
           ((on (send inc) () ((set n (+ (get n) 1)) (notify changed (get n)) (request total (get n))))
            (on (send seen) (who) ((log who)))
            (on (ok total) (x) ((log x))))))
  (define panel
    '(kind Panel (state)
           ((c (new Counter)))
           ((on (notify changed) (x) ((reply seen "panel"))))))
  (define app
    '(kind App (state)
           ((panel (new Panel)))
           ((on (notify changed) (x) ((reply seen "app") stop))
            (on (request total) (x) ((answer ok (+ x 1000))))
            (on (send poke) () ((send-at ((field panel) (field c)) inc))))))
  (define kinds (list counter panel app))
  (define (scenario events #:policy [p 'by-path] #:gran [g 'turn])
    (make-config #:kinds kinds #:root 'App #:events events #:policy p #:gran g))

  (check-equal? (redex-match? Fields cfg (scenario '((ev ((field panel) (field c)) inc)))) #t)

  ;; One notify, two replies: the panel's and the app's, in hop order. The
  ;; panel passes; the app stops it. The request passes the panel and the app
  ;; answers it; its response comes after both replies whenever it arrives,
  ;; because they were queued first.
  (check-equal? (outcomes (scenario '((ev ((field panel) (field c)) inc))))
                (set '("panel" "app" 1001)))
  ;; The same, sent from the app down through two fields.
  (check-equal? (outcomes (scenario '((ev () poke)))) (set '("panel" "app" 1001)))

  ;; Hop by hop, the replies and the answer interleave differently in the
  ;; queue, but here end up the same.
  (check-equal? (outcomes (scenario '((ev ((field panel) (field c)) inc)) #:gran 'per-hop))
                (set '("panel" "app" 1001)))

  ;; Fields can't move: every property, under every policy and granularity.
  (for* ([p '(by-path by-path-checked by-identity)] [g '(turn per-hop)])
    (define c (scenario '((ev ((field panel) (field c)) inc) (ev () poke)) #:policy p #:gran g))
    (for ([inv (list p1-identity p2-exactly-once p3-sound p7-hops)])
      (check-false (counterexample fields-> c inv) (format "~a ~a ~a" p g (object-name inv)))))
  (check-true (policies-agree? fields-> (λ (p) (scenario '((ev ((field panel) (field c)) inc) (ev () poke))
                                                        #:policy p))
                               '(by-path by-path-checked by-identity)))

  ;; P5, location independence: a counter at the root, and the same counter
  ;; under a wrapper that handles nothing, give the host the same messages.
  (define alone
    '(kind Solo (state (n 0))
           ()
           ((on (send inc) () ((set n (+ (get n) 1)) (notify changed (get n)) (request save (get n))))
            (on (ok save) (x) ((log x)))
            (on (send ack) (x) ((log x))))))
  (define wrap '(kind Wrap (state) ((child (new Solo))) ()))
  (define host '(host ((on (notify changed) (x) ((log x) (reply ack (+ x 10)) stop))
                       (on (request save) (x) ((answer ok (+ x 100)))))))
  (define (placed root path)
    (make-config #:kinds (list alone wrap) #:root root #:host host
                 #:events `((ev ,path inc) (ev ,path inc))))
  (check-equal? (outcomes (placed 'Solo '())) (outcomes (placed 'Wrap '((field child)))))
  (check-true (set-member? (outcomes (placed 'Solo '())) '(1 11 101 2 12 102))))
