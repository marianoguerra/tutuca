#lang racket
;; M7, state machines: a kind can declare control states, (states q0 (q
;; handler ...) ...). An instance is in one of them, at first q0, and (goto q)
;; moves it. A handler of the current state is used before one common to all
;; states (the kind's own list).
;;
;; A component may handle a message in one state and not in another. So a
;; request sent in state S can be answered after the component moved to S1,
;; where nothing handles the response: it is delivered to the right instance,
;; and ignored. Routing can't help: even by-identity breaks P6.
;;
;; well-formed? makes P6 a theorem instead: for every request n a kind sends,
;; every state reachable from the one the sending handler leaves it in, until
;; a response to n is taken, handles every response to n the kind handles
;; anywhere. The model checker confirms
;; it, under by-identity, on the scenarios below.
(require redex/reduction-semantics "engine.rkt" (only-in "swap.rkt" Swap swap-tier swap->))
(provide Fsm fsm-tier fsm-> make-config own-clauses well-formed? (all-defined-out))

(define-extended-language Fsm Swap
  (kdef ::= .... (kind k (state (g e) ...) ((f snew) ...) (handler ...) (states q (q handler ...) ...)))
  (c ::= .... (comp k ι ((g v) ...) ((f sval) ...) q))
  (act ::= .... (goto q)))

(define-tier fsm-tier Fsm #:extends swap-tier #:relation fsm->
  ;; an instance starts in its kind's first state
  [finish
   [(finish (kind k any_1 any_2 any_3 (states q any ...)) (comp any_c ...)) (comp any_c ... q)]]
  ;; the current state's handlers come before the kind's common ones
  [handler-for
   [(handler-for K (comp k ι any_l any_s q) hkey) handler
    (where (kind k any_1 any_2 any_3 (states q_0 any_q ... (q handler_q ...) any_r ...)) (kind-def K k))
    (where handler (find-handler (handler_q ...) hkey))]]
  [acts
   [(acts ((goto q) act ...) (comp k ι any_l any_s q_0) env K ν) (acts (act ...) (comp k ι any_l any_s q) env K ν)
    (where (kind k any_1 any_2 any_3 (states q_1 any_q ... (q any_h ...) any_r ...)) (kind-def K k))]])

(define (control c) (match c [(list 'comp _ _ _ _ q) q] [_ #f]))

;; ---- the protocol check ------------------------------------------------------
;; What a handler's actions may do, through every branch.
(define (acts-of acts)
  (append* (for/list ([a acts])
             (match a [`(if ,_ ,t ,e) (cons a (append (acts-of t) (acts-of e)))] [_ (list a)]))))
(define (gotos h) (for/list ([a (acts-of (fourth h))] #:when (match a [`(goto ,_) #t] [_ #f])) (second a)))
(define (requests h)
  (for/list ([a (acts-of (fourth h))] #:when (match a [`(,(or 'request 'request/urgent) . ,_) #t] [_ #f]))
    (second a)))

(define (well-formed? kdef)
  (match kdef
    [(list 'kind _ _ _ common (list 'states _ (list qs hss ...) ...))
     (define (handlers-in q) (append (cdr (assq q (map cons qs hss))) common))
     (define (handles? q key) (findf (λ (h) (equal? (second h) key)) (handlers-in q)))
     ;; a handler that moves nowhere stays in q
     (define (after q h) (match (gotos h) ['() (list q)] [gs gs]))
     ;; the states reachable from q while the request is open: through every
     ;; handler but the ones that take its response
     (define (reachable from responses)
       (let loop ([todo (list from)] [seen (set)])
         (match todo
           ['() seen]
           [(cons q rest) #:when (set-member? seen q) (loop rest seen)]
           [(cons q rest)
            (define open (filter (λ (h) (not (member (second h) responses))) (handlers-in q)))
            (loop (append rest (append-map (λ (h) (after q h)) open)) (set-add seen q))])))
     (for*/and ([q qs] [h (handlers-in q)] [n (requests h)])
       (define responses (remove-duplicates
                          (for*/list ([r '(ok error unhandled)] [q* qs] #:when (handles? q* `(,r ,n)))
                            `(,r ,n))))
       (for*/and ([q0 (after q h)] [q* (reachable q0 responses)] [key responses])
         (and (handles? q* key) #t)))]
    [_ #t]))

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals fsm-> c))))

  ;; A loader: idle, then loading until its response comes, then done. It can
  ;; be cancelled while loading, back to idle, where it doesn't expect the
  ;; response any more.
  (define (loader idle-extra)
    `(kind Loader (state)
           ()
           ()
           (states idle
                   (idle (on (send load) () ((request fetch) (goto loading))) ,@idle-extra)
                   (loading (on (ok fetch) (x) ((log x) (goto done)))
                            (on (send cancel) () ((goto idle))))
                   (done))))
  (define sloppy (loader '()))
  (define careful (loader '((on (ok fetch) (x) ((log "late"))))))
  (define host '(host ((on (request fetch) () ((answer ok 1))))))
  (define events '((ev () load) (ev () cancel)))
  (define (scenario kind #:policy [p 'by-identity])
    (make-config #:kinds (list kind) #:root 'Loader #:host host #:events events #:policy p))
  (check-exn #rx"not in domain" (λ () (apply-reduction-relation swap-> (scenario sloppy))))
  (check-equal? (control (config-tree (scenario sloppy))) 'idle)

  ;; Cancelled, then answered: the response reaches the right loader, in idle,
  ;; which has no handler for it. Even by-identity breaks P6.
  (check-equal? (outcomes (scenario sloppy)) (set '(1) '()))
  (check-false (counterexample fsm-> (scenario sloppy) p3-sound))
  (let ([trace (counterexample fsm-> (scenario sloppy) p6-protocol)])
    (check-true (and trace #t))
    (check-match (config-obs (cdr (last trace))) (list _ ... `(ignored (response . ,_) fetch 0) _ ...)))
  (check-false (well-formed? sloppy))

  ;; Handling the late response in idle makes the protocol well formed, and P6
  ;; holds in every interleaving.
  (check-true (well-formed? careful))
  (check-equal? (outcomes (scenario careful)) (set '(1) '("late")))
  (for ([p '(by-path by-path-checked by-identity anchored)])
    (for ([inv (list p1-identity p2-exactly-once p3-sound p6-protocol)])
      (check-false (counterexample fsm-> (scenario careful #:policy p) inv) (format "~a ~a" p (object-name inv)))))

  ;; A kind without states can't change what it handles: well formed.
  (check-true (well-formed? '(kind Plain (state) () ((on (send go) () ((request fetch))))))))
