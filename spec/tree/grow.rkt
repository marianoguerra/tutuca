#lang racket
;; M2, collections that only grow: a list can be appended to, a map given a new
;; key, and nothing else.
;;
;; A list grows with (append f mk), a map with (add-key f κ mk), where mk is
;; (new k (g e) ...): an instance of k, the locals given overriding its state.
;; Paths get (index f i) and (key f κ), and written paths (sel f g): the item
;; of list f at the index in the parent's local g, as this.tabs[this.selected].
;; A sel is resolved when the path is recorded, as tutuca freezes a selector:
;; an env event's when it arrives, a send-at's against the committed tree, the
;; sender's own changes included. Appending never moves an item that exists,
;; so every recorded path still reaches what it reached.
(require redex/reduction-semantics "engine.rkt" (only-in "fields.rkt" Fields fields-tier fields->))
(provide Grow grow-tier grow-> make-config own-clauses (all-defined-out))

(define-extended-language Grow Fields
  (sval ::= .... (list item ...) (map (v item) ...))
  (item ::= c)
  (step ::= .... (index f natural) (key f v))
  (pstep ::= .... (index f e) (key f e) (sel f g))
  (snew ::= .... (list) (map))
  (e ::= .... (len f))
  (act ::= .... (append f mk) (add-key f e mk)))

(define-tier grow-tier Grow #:extends fields-tier #:relation grow->
  ;; the item a step reaches: an instance, or what a later tier leaves there
  [item-at
   [(item-at c (index f natural)) (nth (any ...) natural) (where (list any ...) (slot-of c f))]
   [(item-at c (key f v)) any_i (where (map any_1 ... (v any_i) any_2 ...) (slot-of c f))]
   [(item-at any_1 any_2) none]]
  [item-set
   [(item-set c (index f natural) any_x) (slot-set c f (list any_1 ...))
    (where (list any ...) (slot-of c f))
    (where (any_1 ...) (set-nth (any ...) natural any_x))]
   [(item-set c (key f v) any_x) (slot-set c f (map any_1 ... (v any_x) any_2 ...))
    (where (map any_1 ... (v any_0) any_2 ...) (slot-of c f))]]
  [nth
   [(nth (any_0 any ...) 0) any_0]
   [(nth (any_0 any ...) natural) (nth (any ...) ,(sub1 (term natural))) (side-condition (> (term natural) 0))]
   [(nth any_1 any_2) none]]
  [set-nth
   [(set-nth (any_0 any ...) 0 any_x) (any_x any ...)]
   [(set-nth (any_0 any ...) natural any_x) (any_0 any_1 ...)
    (side-condition (> (term natural) 0))
    (where (any_1 ...) (set-nth (any ...) ,(sub1 (term natural)) any_x))]]
  [has-key
   [(has-key (any_1 ... v any_2 ...) v) #t]
   [(has-key any v) #f]]
  [child-at
   [(child-at c_1 (index f natural)) c (where c (item-at c_1 (index f natural)))]
   [(child-at c_1 (key f v)) c (where c (item-at c_1 (key f v)))]]
  [put-child
   [(put-child c_1 (index f natural) c) (item-set c_1 (index f natural) c)]
   [(put-child c_1 (key f v) c) (item-set c_1 (key f v) c)]]
  [slot-children
   [(slot-children ((f (list any_i ...)) any ...)) (any_c ... any_r ...)
    (where (any_c ...) (indexed f 0 (any_i ...)))
    (where (any_r ...) (slot-children (any ...)))]
   [(slot-children ((f (map any_e ...)) any ...)) (any_c ... any_r ...)
    (where (any_c ...) (keyed f (any_e ...)))
    (where (any_r ...) (slot-children (any ...)))]]
  [indexed
   [(indexed f natural ()) ()]
   [(indexed f natural (c any ...)) (((index f natural) c) any_1 ...)
    (where (any_1 ...) (indexed f ,(add1 (term natural)) (any ...)))]
   [(indexed f natural (any_0 any ...)) (indexed f ,(add1 (term natural)) (any ...))]]
  [keyed
   [(keyed f ()) ()]
   [(keyed f ((v c) any ...)) (((key f v) c) any_1 ...) (where (any_1 ...) (keyed f (any ...)))]
   [(keyed f (any_0 any ...)) (keyed f (any ...))]]
  [eval-step
   [(eval-step (index f e) self env) (index f (eval e self env))]
   [(eval-step (key f e) self env) (key f (eval e self env))]]
  ;; sel reads the index from the parent's local, here: in the committed tree
  ;; for a send-at, in the tree as it is for an env event
  [concretize
   [(concretize c_1 (sel f g)) (concretize c_1 (index f v)) (where (comp k ι (any_1 ... (g v) any_2 ...) any ...) c_1)]
   [(concretize c_1 (index f natural)) (index f natural) (where c (child-at c_1 (index f natural)))]
   [(concretize c_1 (key f v)) (key f v) (where c (child-at c_1 (key f v)))]]
  [make-slot
   [(make-slot K (list) ν) ((list) ν)]
   [(make-slot K (map) ν) ((map) ν)]]
  [eval
   [(eval (len f) c env) ,(length (term (any ...))) (where (list any ...) (slot-of c f))]
   [(eval (len f) c env) ,(length (term (any ...))) (where (map any ...) (slot-of c f))]]
  [acts
   [(acts ((append f mk) act ...) self env K ν) (acts (act ...) (slot-set self f (list any ... c)) env K ν_1)
    (where (list any ...) (slot-of self f))
    (where (c ν_1) (make-new K mk self env ν))]
   [(acts ((add-key f e mk) act ...) self env K ν) (acts (act ...) (slot-set self f (map (v_1 any_1) ... (v c))) env K ν_1)
    (where v (eval e self env))
    (where (map (v_1 any_1) ...) (slot-of self f))
    (where #f (has-key (v_1 ...) v))
    (where (c ν_1) (make-new K mk self env ν))]])

(module+ test
  (require rackunit "check.rkt")
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))
  (define (outcomes c) (list->set (map logs (finals grow-> c))))
  (define all-policies '(by-path by-path-checked by-identity))

  ;; An item asks its list for something about its label, and logs the answer.
  (define item
    '(kind Item (state (label 0) (ready 0))
           ()
           ((on (send init) () ((set ready 1)))
            (on (send go) () ((request fetch (get label))))
            (on (ok fetch) (x) ((log x))))))
  ;; Append, then init the new item in the same transaction: the item isn't in
  ;; the tree the handler reads, but it is in the committed tree, where send-at
  ;; is resolved.
  (define todos
    '(kind Todos (state (count 0))
           ((items (list)) (named (map)))
           ((on (send push) ()
                ((set count (+ (get count) 1))
                 (append items (new Item (label (get count))))
                 (send-at ((index items (- (len items) 1))) init)))
            (on (send name) (k) ((add-key named k (new Item (label 7))) (send-at ((key named k)) init)))
            (on (request fetch) (l) ((answer ok (+ l 100)))))))
  (define (scenario events #:policy [p 'by-path] #:gran [g 'turn])
    (make-config #:kinds (list item todos) #:root 'Todos #:events events #:policy p #:gran g))
  (check-equal? (redex-match? Grow cfg (scenario '((ev () push)))) #t)
  ;; Todos is instance 0, its first item 1.
  (check-match (config-obs (car (finals grow-> (scenario '((ev () push))))))
               (list _ ... '(deliver send init 1 1) _ ...))
  (check-equal? (outcomes (scenario '((ev () push) (ev ((index items 0)) go)))) (set '(101)))
  (check-equal? (outcomes (scenario '((ev () name "a") (ev ((key named "a")) go)))) (set '(107)))

  ;; The list grows while requests are in flight: each response still reaches
  ;; its asker, under every policy.
  (define growing '((ev () push) (ev ((index items 0)) go) (ev () push) (ev ((index items 1)) go)))
  (for* ([p all-policies] [g '(turn per-hop)])
    (define c (scenario growing #:policy p #:gran g))
    (for ([inv (list p1-identity p2-exactly-once p3-sound p7-hops)])
      (check-false (counterexample grow-> c inv) (format "~a ~a ~a" p g (object-name inv)))))
  (check-equal? (outcomes (scenario growing)) (set '(101 102) '(102 101)))
  (check-true (policies-agree? grow-> (λ (p) (scenario growing #:policy p)) all-policies))

  ;; sel: an env event's route is fixed when it arrives, so which tab gets ping
  ;; depends on whether next arrived first. That is the event's meaning, not a
  ;; misroute. A send-at's sel reads the committed tree: the tab selected by the
  ;; same transaction.
  (define tab
    '(kind Tab (state (id 0))
           ()
           ((on (send init) (i) ((set id i)))
            (on (send ping) () ((log (get id)))))))
  (define tabs
    '(kind Tabs (state (selected 0) (n 0))
           ((tabs (list)))
           ((on (send open) ()
                ((append tabs (new Tab)) (send-at ((index tabs (get n))) init (get n)) (set n (+ (get n) 1))))
            (on (send next) () ((set selected (+ (get selected) 1))))
            (on (send ping-next) () ((set selected (+ (get selected) 1)) (send-at ((sel tabs selected)) ping))))))
  (define (tabbed events)
    (make-config #:kinds (list tab tabs) #:root 'Tabs #:events events))
  ;; The tabs are instances 1 and 2; which one each final configuration pinged.
  (define (pinged c)
    (list->set (for/list ([f (finals grow-> c)])
                 (for/list ([o (config-obs f)] #:when (match o [`(deliver send ping . ,_) #t] [_ #f]))
                   (fifth o)))))
  (check-equal? (pinged (tabbed '((ev () open) (ev () open) (ev ((sel tabs selected)) ping) (ev () next))))
                (set '(1)))
  (check-equal? (pinged (tabbed '((ev () open) (ev () open) (ev () next) (ev ((sel tabs selected)) ping))))
                (set '(2)))
  (check-equal? (pinged (tabbed '((ev () open) (ev () open) (ev () ping-next)))) (set '(2)))
  ;; An env event skips the queue, so it can reach a tab before the tab's init
  ;; (queued by open) has run: the ping logs 1 or the default, 0.
  (check-equal? (outcomes (tabbed '((ev () open) (ev () open) (ev () next) (ev ((sel tabs selected)) ping))))
                (set '(0) '(1)))
  (check-false (counterexample grow-> (tabbed '((ev () open) (ev () open) (ev () ping-next) (ev () next)))
                               p3-sound)))
