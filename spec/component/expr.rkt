#lang racket
;; Expressions: the pure JavaScript a component supplies, as a small language.
;;
;; The runtime calls user functions for field predicates, invariants, message
;; contracts and handlers, loop hooks (key, filter, enrich) and scope binds.
;; The model replaces each with a term in this expression language; class.rkt
;; and view.rkt say where each kind of term goes. Loop `prepare` and `iter` are
;; arbitrary iteration protocols; the model covers what `filter` and `key` can
;; express and leaves them out.
(require redex/reduction-semantics "../data.rkt" "paths.rkt")
(provide Expr eval-hx def-section def-name lookup-named env-extend)

(define-extended-language Expr Paths
  (x ::= variable)
  (env ::= ((x value) ...))
  (hx ::= value x
          (get hx fname) (at hx hx)      ; v.f and v[k]
          (= hx hx) (< hx hx) (not hx) (and hx ...) (if hx hx hx) (+ hx hx)
          (push hx hx)                   ; [...xs, x]
          (mk-rec (fname hx) ...) (mk-arr hx ...)))

(define-metafunction Expr
  env-extend : env (x value) ... -> env
  [(env-extend ((x_e value_e) ...) (x value) ...) ((x value) ... (x_e value_e) ...)])

(define-metafunction Expr
  eval-hx : env hx -> value
  [(eval-hx env value) value]
  [(eval-hx (any_1 ... (x value) any_2 ...) x) value
   (side-condition (not (assq (term x) (term (any_1 ...)))))]
  [(eval-hx env (get hx fname)) (prop-get (eval-hx env hx) fname)]
  [(eval-hx env (at hx_1 hx_2)) (prop-get (eval-hx env hx_1) (eval-hx env hx_2))]
  [(eval-hx env (= hx_1 hx_2)) ,(equal? (term (eval-hx env hx_1)) (term (eval-hx env hx_2)))]
  [(eval-hx env (< hx_1 hx_2)) ,(< (term number_1) (term number_2))
   (where number_1 (eval-hx env hx_1))
   (where number_2 (eval-hx env hx_2))]
  [(eval-hx env (not hx)) ,(not (truthy? (term (eval-hx env hx))))]
  [(eval-hx env (and)) #t]
  [(eval-hx env (and hx_0 hx ...)) (eval-hx env (and hx ...))
   (side-condition (truthy? (term (eval-hx env hx_0))))]
  [(eval-hx env (and hx_0 hx ...)) (eval-hx env hx_0)]
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

;; Definitions are (head name section ...); sections may come in any order
;; and may be omitted.
(define (def-name def) (second def))

;; A section's entries, empty when the definition omits it.
(define (def-section def name)
  (match def
    [(list _ _ sections ...)
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
  (test-equal (term (eval-hx () (and 1 (< 1 2)))) #t)
  ;; and returns the first falsy operand, and does not evaluate the rest.
  (test-equal (term (eval-hx () (and 0 missing))) 0)
  ;; Inner bindings shadow outer ones.
  (test-equal (term (eval-hx (env-extend ((a 1)) (a 2)) a)) 2)
  ;; Unbound names and arithmetic on non-numbers throw.
  (check-exn exn:fail? (λ () (term (eval-hx () missing))))
  (check-exn exn:fail? (λ () (term (eval-hx () (+ "a" 1)))))
  (check-exn exn:fail? (λ () (term (eval-hx () (< "a" 1)))))

  (define def '(class Item (fields) (on (inc () (step)))))
  (test-equal (def-name def) 'Item)
  (test-equal (def-section def 'loops) '())
  (test-equal (lookup-named (def-section def 'on) 'inc) '(inc () (step)))
  (test-results))
