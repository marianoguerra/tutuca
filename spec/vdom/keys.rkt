#lang racket
;; Sibling matching in morphChildren. Indices identify previous virtual nodes,
;; each of which may own zero, one or several actual DOM nodes. Matching never
;; searches through a fragment boundary. Mounting has no duplicate-key check;
;; these rules apply when an old and a new sibling sequence are compared.
(require redex/reduction-semantics "core.rkt")
(provide Keyed node-key keys-unique? find-key unkeyed-indices match-next match-siblings)

(define-extended-language Keyed Core
  (index ::= natural)
  (match-result ::= index fresh)
  (matches ::= (match-result ...) duplicate-keys))

(define-metafunction Keyed
  node-key : node -> key?
  [(node-key (el tid tag ns? key? (prop ...) (node ...))) key?]
  [(node-key (group key? (node ...))) key?]
  [(node-key leaf) none])

;; Equality here is string equality: normalization has already coerced keys.
(define-metafunction Keyed
  keys-unique? : (node ...) -> boolean
  [(keys-unique? (node ...))
   ,(let ([keys (filter string? (term ((node-key node) ...)))])
      (= (length keys) (length (remove-duplicates keys))))])

(define-metafunction Keyed
  find-key : string (node ...) index -> match-result
  [(find-key string () index) fresh]
  [(find-key string (node_0 node ...) index) index
   (where string (node-key node_0))]
  [(find-key string (node_0 node ...) index)
   (find-key string (node ...) ,(add1 (term index)))])

(define-metafunction Keyed
  unkeyed-indices : (node ...) index -> (index ...)
  [(unkeyed-indices () index) ()]
  [(unkeyed-indices (node_0 node ...) index) (index index_rest ...)
   (where none (node-key node_0))
   (where (index_rest ...) (unkeyed-indices (node ...) ,(add1 (term index))))]
  [(unkeyed-indices (node_0 node ...) index)
   (unkeyed-indices (node ...) ,(add1 (term index)))])

;; A keyed target finds its key in the old sequence. An unkeyed target takes
;; the next old unkeyed node, independently of keyed targets and placement.
(define-metafunction Keyed
  match-next : (node ...) (node ...) (index ...) -> (match-result ...)
  [(match-next (node_old ...) () (index ...)) ()]
  [(match-next (node_old ...) (node_0 node ...) (index ...))
   ((find-key string (node_old ...) 0) match-result ...)
   (where string (node-key node_0))
   (where (match-result ...) (match-next (node_old ...) (node ...) (index ...)))]
  [(match-next (node_old ...) (node_0 node ...) (index_0 index ...))
   (index_0 match-result ...)
   (where none (node-key node_0))
   (where (match-result ...) (match-next (node_old ...) (node ...) (index ...)))]
  [(match-next (node_old ...) (node_0 node ...) ())
   (fresh match-result ...)
   (where none (node-key node_0))
   (where (match-result ...) (match-next (node_old ...) (node ...) ()))])

(define-metafunction Keyed
  match-siblings : (node ...) (node ...) -> matches
  [(match-siblings (node_old ...) (node_new ...))
   (match-next (node_old ...) (node_new ...) (unkeyed-indices (node_old ...) 0))
   (where #t (keys-unique? (node_old ...)))
   (where #t (keys-unique? (node_new ...)))]
  [(match-siblings (node_old ...) (node_new ...)) duplicate-keys])

(module+ test
  ;; Empty fragments are still matchable virtual groups.
  (test-equal (term (match-siblings ((group "a" ()) (group "b" ((text "B"))))
                                    ((group "b" ((text "new"))) (group "a" ((text "A"))))))
              (term (1 0)))
  ;; Changed content does not change keyed identity; insertion has no previous node.
  (test-equal (term (match-siblings ((group "a" ((text "A"))) (group "b" ()))
                                    ((group "b" ()) (group "new" ()) (group "a" ()))))
              (term (1 fresh 0)))
  ;; Unkeyed nodes match in order, skipping keyed nodes. Kinds are checked later.
  (test-equal (term (match-siblings ((text "first") (group "a" ()) (group none ()))
                                    ((group "a" ()) (group none ()) (text "second") (text "new"))))
              (term (1 0 2 fresh)))
  ;; Metadata leaves are unkeyed siblings like any other leaf.
  (test-equal (term (match-siblings ((meta-open component) (el 1 "b" none none () ()) meta-close)
                                    ((meta-open component) (el 1 "b" none none () ()) meta-close)))
              (term (0 1 2)))
  ;; Every explicit fragment, including an unkeyed loop, is a separate scope.
  (define loops (term ((group none ((group "a" ()))) (group none ((group "a" ()))))))
  (test-equal (term (match-siblings ,loops ,loops)) (term (0 1)))
  (test-equal (term (match-siblings ((group "left" ((group "a" ())))) ((group "a" ()))))
              (term (fresh)))
  ;; A key collides across node kinds within the same compared sibling scope.
  (test-equal (term (match-siblings () ((group "a" ()) (el 0 "i" none "a" () ()))))
              (term duplicate-keys))
  (test-equal (term (match-siblings ((group "a" ()) (group "a" ())) ()))
              (term duplicate-keys))
  (test-equal (term (match-siblings () ())) (term ()))
  (test-results))
