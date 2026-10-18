#lang racket
;; Host layer: the JavaScript a component supplies, as a small pure language.
;;
;; The runtime calls user functions for loop hooks (key, filter, enrich), scope
;; binds, provider path builders, ask handlers and message handlers. The model
;; replaces each with a term: host expressions hx for the pure hooks, path
;; builder terms for provides, and a command language for handlers (tasks.rkt
;; interprets it). Loop `prepare` and `iter` are arbitrary iteration protocols;
;; the model covers what `filter` and `key` can express and leaves them out.
(require redex/reduction-semantics "data.rkt" "paths.rkt")
(provide Host eval-hx class-section class-name lookup-named env-extend)

(define-extended-language Host Paths
  (x ::= variable)
  (env ::= ((x value) ...))
  (hx ::= value x
          (get hx fname) (at hx hx)      ; v.f and v[k]
          (= hx hx) (not hx) (if hx hx hx) (+ hx hx)
          (push hx hx)                   ; [...xs, x]
          (mk-rec (fname hx) ...) (mk-arr hx ...))
  (view-name ::= string)
  (view-name? ::= view-name none)
  ;; A component definition, component({...}) minus the schema: sections may
  ;; come in any order and may be omitted.
  (class-def ::= (class cname section ...))
  (section ::= (views (view-name any) ...)  ; view expressions, see view.rkt
               (on handler ...)
               (loops loop ...)
               (scopes (fname hx) ...)     ; bind(): self -> record of binds
               (provides (fname sel) ...))
  ;; A message handler: name, parameters bound to the args, then commands.
  (handler ::= (fname (x ...) cmd ...))
  ;; loops[name]: key(key, value), filter(key, value), enrich(base), view; all see self
  (loop ::= (fname loop-opt ...))
  (loop-opt ::= (key hx) (filter hx) (enrich hx) (view view-name))
  ;; Commands run against the draft: `draft` is the current leaf, `self` the
  ;; instance before the task, `sourceKey` ctx.sourceKey.
  (cmd ::= (set (lv ...) hx)               ; draft.a.b = v
           (replace hx)                    ; return a replacement
           (notify fname hx ...) (ask fname hx ...)
           (send-at fname (hx ...) sel) (forward-at sel)
           (stop-next)
           (log hx)                        ; an observable side effect
           (fail hx)                       ; throw
           (when hx cmd ...))
  (lv ::= fname (at hx))
  ;; Ask handlers, registered on a scope: args -> result, or a promise. The
  ;; runtime also passes ctx, so an ask handler can send tasks; the model does not.
  (ask-def ::= (fname ask-result))
  (ask-result ::= (ok hx) (error hx) (async (ok hx)) (async (error hx))))

(define-metafunction Host
  env-extend : env (x value) ... -> env
  [(env-extend ((x_e value_e) ...) (x value) ...) ((x value) ... (x_e value_e) ...)])

(define-metafunction Host
  eval-hx : env hx -> value
  [(eval-hx env value) value]
  [(eval-hx (any_1 ... (x value) any_2 ...) x) value
   (side-condition (not (assq (term x) (term (any_1 ...)))))]
  [(eval-hx env (get hx fname)) (prop-get (eval-hx env hx) fname)]
  [(eval-hx env (at hx_1 hx_2)) (prop-get (eval-hx env hx_1) (eval-hx env hx_2))]
  [(eval-hx env (= hx_1 hx_2)) ,(equal? (term (eval-hx env hx_1)) (term (eval-hx env hx_2)))]
  [(eval-hx env (not hx)) ,(not (truthy? (term (eval-hx env hx))))]
  [(eval-hx env (if hx_c hx_t hx_e)) (eval-hx env hx_t)
   (side-condition (truthy? (term (eval-hx env hx_c))))]
  [(eval-hx env (if hx_c hx_t hx_e)) (eval-hx env hx_e)]
  [(eval-hx env (+ hx_1 hx_2)) ,(+ (term number_1) (term number_2))
   (where number_1 (eval-hx env hx_1))
   (where number_2 (eval-hx env hx_2))]
  [(eval-hx env (push hx_1 hx_2)) (arr value ... (eval-hx env hx_2))
   (where (arr value ...) (eval-hx env hx_1))]
  [(eval-hx env (mk-rec (fname hx) ...)) (rec (fname (eval-hx env hx)) ...)]
  [(eval-hx env (mk-arr hx ...)) (arr (eval-hx env hx) ...)])

(define (class-name def) (second def))

;; A section's entries, empty when the definition omits it.
(define (class-section def name)
  (match def
    [(list 'class _ sections ...)
     (or (for/first ([s sections] #:when (eq? (first s) name)) (rest s)) '())]))

;; Entries are (name ...) lists; #f when the name is absent.
(define (lookup-named entries name)
  (for/first ([e entries] #:when (equal? (first e) name)) e))

(module+ test
  (require rackunit)
  (test-equal (term (eval-hx ((a 1)) (+ a 2))) 3)
  (test-equal (term (eval-hx ((r (rec (n 1)))) (get r n))) 1)
  (test-equal (term (eval-hx ((xs (arr "a" "b")) (i 1)) (at xs i))) "b")
  (test-equal (term (eval-hx ((xs (arr))) (push xs 1))) (term (arr 1)))
  (test-equal (term (eval-hx () (mk-rec (key 1) (value (= 1 1))))) (term (rec (key 1) (value #t))))
  (test-equal (term (eval-hx ((a "")) (if a 1 2))) 2)
  ;; Inner bindings shadow outer ones.
  (test-equal (term (eval-hx (env-extend ((a 1)) (a 2)) a)) 2)
  ;; Unbound names and arithmetic on non-numbers throw.
  (check-exn exn:fail? (λ () (term (eval-hx () missing))))
  (check-exn exn:fail? (λ () (term (eval-hx () (+ "a" 1)))))

  (define def (term (class Item (views ("main" "x")) (on (inc () (set (count) (+ (get draft count) 1)))))))
  (test-equal (redex-match? Host class-def def) #t)
  (test-equal (class-section def 'loops) '())
  (test-equal (lookup-named (class-section def 'on) 'inc) '(inc () (set (count) (+ (get draft count) 1))))
  (test-equal (redex-match? Host loop (term (byId (key (get value id)) (view "row")))) #t)
  (test-equal (redex-match? Host ask-def (term (load (async (ok "loaded"))))) #t)
  (test-results))
