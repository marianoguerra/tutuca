#lang racket
;; Reconciliation: morphNode/morphChildren in vdom.js, over DOM nodes with
;; identities. A labeled DOM node is the browser's node object: morphing keeps
;; a label when the runtime keeps the node (patching it in place, possibly
;; moving it) and mints a fresh one when the runtime creates a node.
;;
;; Erased optimizations: skipping a node when source === target or
;; source.isEqualTo(target), writing only props whose value changed, and the
;; childNodes snapshot taken before editing. Patching every prop of a node gives the same DOM, so the
;; model patches everything. It assumes, like those skips, that only the
;; runtime mutates the managed DOM.
(require redex/reduction-semantics "vnode.rkt" "dom.rkt" "keys.rkt")
(provide el-ns split-groups morph-seq morph-one
         Morph mount mount-all morph-children morph-node dom-width erase erase-all)

(define-extended-language Morph Keyed
  (lbl ::= natural)
  (dom ::= (element ns tag (prop ...) (dom ...)) (text string) (comment string))  ; as in dom.rkt
  (ldom ::= (element lbl ns tag (prop ...) (ldom ...)) (text lbl string) (comment lbl string))
  (lgroups ::= ((ldom ...) ...))
  (out ::= ((ldom ...) lbl)))              ; nodes, and the next fresh label

(define-metafunction Morph
  el-ns : ns? ns -> ns
  [(el-ns none ns) ns]
  [(el-ns ns_el ns) ns_el])

;; toDom, minting a label for every node it creates.
(define-metafunction Morph
  mount : node ns lbl -> out
  [(mount (text string) ns lbl) (((text lbl string)) ,(add1 (term lbl)))]
  [(mount (comment string) ns lbl) (((comment lbl string)) ,(add1 (term lbl)))]
  [(mount (group key? (node ...)) ns lbl) (mount-all (node ...) ns lbl)]
  [(mount (el tid tag ns? key? (prop ...) (node ...)) ns lbl)
   (((element lbl ns_el tag (prop ...) (ldom ...))) lbl_next)
   (where ns_el (el-ns ns? ns))
   (where ((ldom ...) lbl_next) (mount-all (node ...) (child-ns tag ns_el) ,(add1 (term lbl))))])

(define-metafunction Morph
  mount-all : (node ...) ns lbl -> out
  [(mount-all () ns lbl) (() lbl)]
  [(mount-all (node_0 node ...) ns lbl) ((ldom_0 ... ldom ...) lbl_2)
   (where ((ldom_0 ...) lbl_1) (mount node_0 ns lbl))
   (where ((ldom ...) lbl_2) (mount-all (node ...) ns lbl_1))])

;; A fragment owns the sum of its children's DOM widths, including zero.
(define-metafunction Morph
  dom-width : node -> natural
  [(dom-width (group key? (node ...))) ,(apply + (term ((dom-width node) ...)))]
  [(dom-width node) 1])

;; The DOM nodes each old virtual node owns.
(define-metafunction Morph
  split-groups : (ldom ...) (node ...) -> lgroups
  [(split-groups () ()) ()]
  [(split-groups (ldom ...) (node_0 node ...))
   (,(take (term (ldom ...)) (term natural)) any_rest ...)
   (where natural (dom-width node_0))
   (where (any_rest ...) (split-groups ,(drop (term (ldom ...)) (term natural)) (node ...)))])

;; Patch a matched pair of non-fragment nodes. Leaves of the same DOM kind keep
;; their node; elements need the same template and key (isSameKind).
(define-metafunction Morph
  morph-node : ldom node node ns lbl -> out
  [(morph-node (text lbl_n string_old) (text string_s) (text string_t) ns lbl)
   (((text lbl_n string_t)) lbl)]
  [(morph-node (comment lbl_n string_old) (comment string_s) (comment string_t) ns lbl)
   (((comment lbl_n string_t)) lbl)]
  [(morph-node (element lbl_n ns_n tag_n (prop_old ...) (ldom ...))
               (el tid tag_s ns?_s key? (prop_s ...) (node_s ...))
               (el tid tag ns? key? (prop ...) (node ...)) ns lbl)
   (((element lbl_n ns_n tag (prop ...) (ldom_new ...))) lbl_next)
   (where ((ldom_new ...) lbl_next)
          (morph-children (ldom ...) (node_s ...) (node ...) (child-ns tag ns_n) lbl))]
  [(morph-node ldom node_s node_t ns lbl) (mount node_t ns lbl)])

;; Each target takes its matched source. Fragment meets fragment: recurse into
;; the owned DOM range. Node meets node: morph-node. Otherwise mount the target
;; and drop the source's nodes. Unmatched sources are removed.
(define-metafunction Morph
  morph-children : (ldom ...) (node ...) (node ...) ns lbl -> out
  [(morph-children (ldom ...) (node_old ...) (node_new ...) ns lbl)
   (morph-seq (split-groups (ldom ...) (node_old ...)) (node_old ...) (node_new ...)
              (match-result ...) ns lbl)
   (where (match-result ...) (match-siblings (node_old ...) (node_new ...)))])

(define-metafunction Morph
  morph-seq : lgroups (node ...) (node ...) (match-result ...) ns lbl -> out
  [(morph-seq lgroups (node_old ...) () () ns lbl) (() lbl)]
  [(morph-seq lgroups (node_old ...) (node_0 node ...) (match-result_0 match-result ...) ns lbl)
   ((ldom_0 ... ldom ...) lbl_2)
   (where ((ldom_0 ...) lbl_1) (morph-one lgroups (node_old ...) node_0 match-result_0 ns lbl))
   (where ((ldom ...) lbl_2)
          (morph-seq lgroups (node_old ...) (node ...) (match-result ...) ns lbl_1))])

(define-metafunction Morph
  morph-one : lgroups (node ...) node match-result ns lbl -> out
  [(morph-one lgroups (node_old ...) node fresh ns lbl) (mount node ns lbl)]
  [(morph-one lgroups (node_old ...) (group key?_t (node_t ...)) index ns lbl)
   (morph-children ,(list-ref (term lgroups) (term index)) (node_s ...) (node_t ...) ns lbl)
   (where (group key?_s (node_s ...)) ,(list-ref (term (node_old ...)) (term index)))]
  [(morph-one lgroups (node_old ...) node index ns lbl)
   (morph-node ,(first (list-ref (term lgroups) (term index))) node_s node ns lbl)
   (where node_s ,(list-ref (term (node_old ...)) (term index)))
   (side-condition (not (redex-match? Morph (group any ...) (term node_s))))
   (side-condition (not (redex-match? Morph (group any ...) (term node))))]
  [(morph-one lgroups (node_old ...) node index ns lbl) (mount node ns lbl)])

(define-metafunction Morph
  erase : ldom -> dom
  [(erase (text lbl string)) (text string)]
  [(erase (comment lbl string)) (comment string)]
  [(erase (element lbl ns tag (prop ...) (ldom ...))) (element ns tag (prop ...) ((erase ldom) ...))])

(define-metafunction Morph
  erase-all : (ldom ...) -> (dom ...)
  [(erase-all (ldom ...)) ((erase ldom) ...)])

(define (labels ldoms)
  (append* (for/list ([d ldoms])
             (match d
               [(list 'element l _ _ _ kids) (cons l (labels kids))]
               [(list _ l _) (list l)]))))

;; A random vnode sequence over a small alphabet, so that independently drawn
;; trees share templates and keys. Sibling keys are unique.
(define (random-nodes depth)
  (define seen (mutable-set))
  (filter-map
   (λ (_)
     (define n (random-node depth))
     (define k (match n [(list 'el _ _ _ k _ _) k] [(list 'group k _) k] [_ 'none]))
     (cond [(eq? k 'none) n]
           [(set-member? seen k) #f]
           [else (set-add! seen k) n]))
   (range (random 4))))

(define (random-node depth)
  (define key (λ () (list-ref '(none none "x" "y") (random 4))))
  (case (if (zero? depth) (random 3) (random 5))
    [(0) `(text ,(list-ref '("a" "b") (random 2)))]
    [(1) `(comment ,(list-ref '("c" "d") (random 2)))]
    [(2) (let ([tid (random 3)])
           `(el ,tid ,(format "t~a" tid) none ,(key)
                ,(if (zero? (random 2)) '() `((title ,(random 2))))
                ,(if (zero? depth) '() (random-nodes (sub1 depth)))))]
    [else `(group ,(key) ,(random-nodes (sub1 depth)))]))

(module+ test
  (require rackunit)
  (define H HTML-NS)
  (define (mount* nodes) (term (mount-all ,nodes ,H 0)))
  (define (morph* old new)
    (match-define (list doms next) (mount* old))
    (term (morph-children ,doms ,old ,new ,H ,next)))

  ;; Patching keeps the node and writes the new props and text.
  (define p (λ (cls txt) `((el 0 "p" none none ((class ,cls)) ((text ,txt))) (text "tail"))))
  (test-equal (mount* (p "a" "one"))
              (term (((element 0 ,H "p" ((class "a")) ((text 1 "one"))) (text 2 "tail")) 3)))
  (test-equal (morph* (p "a" "one") (p "b" "two"))
              (term (((element 0 ,H "p" ((class "b")) ((text 1 "two"))) (text 2 "tail")) 3)))

  ;; Same tag, different template: the element is replaced.
  (test-equal (morph* '((el 0 "div" none none ((class "a")) ()))
                      '((el 1 "div" none none ((title "t")) ())))
              (term (((element 1 ,H "div" ((title "t")) ())) 2)))

  ;; Keyed reorder moves nodes, keeping identities, including across groups
  ;; whose DOM width changes; an empty group owns nothing.
  (define before '((group "a" ((text "A") (el 0 "b" none none () ())))
                   (group "b" ())))
  (define after '((group "b" ((text "C")))
                  (group "a" ((text "A") (el 0 "b" none none () ())))))
  (test-equal (morph* before after)
              (term (((text 2 "C") (text 0 "A") (element 1 ,H "b" () ())) 3)))

  ;; A node and a fragment never match each other's DOM.
  (test-equal (morph* '((text "x")) '((group none ((text "x")))))
              (term (((text 1 "x")) 2)))

  ;; Text never turns into a comment; any two comments patch.
  (test-equal (morph* '((text "x") (comment "c")) '((comment "x") (comment "y")))
              (term (((comment 2 "x") (comment 1 "y")) 3)))

  ;; Duplicate keys in a compared scope have no morph (the runtime throws).
  (check-exn exn:fail? (λ () (morph* '() '((group "a" ()) (group "a" ())))))

  ;; Children mounted while morphing inherit the parent's namespace.
  (define svg (λ kids `((el 0 "svg" ,SVG-NS none () ,kids))))
  (test-equal (term (erase-all ,(first (morph* (svg) (svg '(el 1 "rect" none none () ())
                                                          '(el 2 "foreignObject" none none ()
                                                               ((el 3 "b" none none () ()))))))))
              (term ((element ,SVG-NS "svg" ()
                              ((element ,SVG-NS "rect" () ())
                               (element ,SVG-NS "foreignObject" () ((element ,H "b" () ()))))))))

  ;; Correctness: morphing a mounted tree yields the DOM of the new tree.
  (for ([_ 500])
    (define old (random-nodes 3))
    (define new (random-nodes 3))
    (test-equal (term (erase-all ,(first (morph* old new)))) (term (render ,new))))
  ;; Morphing a tree into itself keeps every node, with the same labels.
  (for ([_ 300])
    (define t (random-nodes 3))
    (test-equal (morph* t t) (mount* t)))
  ;; Every label in the result is either kept from the old DOM or fresh, and
  ;; none is used twice.
  (for ([_ 300])
    (define old (random-nodes 3))
    (define new (random-nodes 3))
    (match-define (list result next) (morph* old new))
    (define ls (labels result))
    (test-equal (length ls) (length (remove-duplicates ls)))
    (test-equal (andmap (λ (l) (< l next)) ls) #t))
  (test-results))
