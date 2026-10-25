#lang racket
;; Core layer: normalized vnodes, what view evaluation builds (vdom.js).
;;
;; An element carries its template identity tid. In the runtime, that is the
;; element's Shape, shared by every render of one DomNode: VNode.isSameKind
;; compares shapes and keys, so two templates with the same tag replace rather
;; than patch each other. Whether an attribute is static (set once on create)
;; or dynamic is an optimization of src/optimize.js; the model keeps all of
;; them as props, sorted by name, since attribute order is not observable.
;;
;; Metadata comments are structured leaves here. dom.rkt serializes them to the
;; JSON comment text the runtime writes, and routing.rkt parses that text back.
(require redex/reduction-semantics json "data.rkt")
(provide shape-of
         Core HTML-NS SVG-NS MATH-NS make-el meta->string string->meta)

(define HTML-NS "http://www.w3.org/1999/xhtml")
(define SVG-NS "http://www.w3.org/2000/svg")
(define MATH-NS "http://www.w3.org/1998/Math/MathML")

(define-extended-language Core Data
  (tag ::= string)
  (ns ::= string)                      ; a namespace URI
  (ns? ::= ns none)                    ; none: the element inherits its parent's
  (tid ::= natural)
  (key? ::= string none)               ; a key, or undefined
  (prop-name ::= (variable-except key namespace null))  ; key and namespace have their own slots
  ;; Props retain vnode and iterable values without turning them into children.
  (prop-value ::= value node (frag prop-value ...))
  (prop ::= (prop-name prop-value))
  ;; What a metadata comment says about the node that follows it: a component
  ;; boundary, or one path frame (see paths.rkt).
  (skey ::= natural string)            ; a property key in a path
  (base ::= none (prov fname natural (skey ...)))  ; a provider jump: name, depth, suffix
  (item? ::= skey none)                ; the item key, when the frame selects an item
  (meta ::= component (frame base (skey ...) item?))
  (leaf ::= (text string) (comment string) (meta-open meta) meta-close)
  ;; Explicit VFragments retain a sibling key scope, even without a key.
  (node ::= (el tid tag ns? key? (prop ...) (node ...))
            (group key? (node ...))
            leaf))

;; new Shape(tag, namespace, ...): with no explicit namespace, svg and math are
;; detected case-insensitively and set their own.
(define-metafunction Core
  shape-of : tag ns? -> (tag ns?)
  [(shape-of tag none) (,(string-downcase (term tag)) ,SVG-NS)
   (side-condition (string-ci=? (term tag) "svg"))]
  [(shape-of tag none) (,(string-downcase (term tag)) ,MATH-NS)
   (side-condition (string-ci=? (term tag) "math"))]
  [(shape-of tag ns?) (tag ns?)])

(define (sort-props props)
  (define sorted (sort props symbol<? #:key car))
  (unless (equal? (remove-duplicates (map car sorted)) (map car sorted))
    (error 'make-el "duplicate prop names in ~a" props))
  sorted)

;; new VNode(shape, values, childs, key)
(define-metafunction Core
  make-el : tid tag ns? key? (prop ...) (node ...) -> node
  [(make-el tid tag ns? key? (prop ...) (node ...))
   (el tid tag_s ns?_s key? ,(sort-props (term (prop ...))) (node ...))
   (where (tag_s ns?_s) (shape-of tag ns?))])

;; ---- metadata comment text ------------------------------------------------
;; JSON.stringify of the meta objects, with the runtime's key order.
(define (json v) (jsexpr->string v))
(define (keys->json ks) (string-append "[" (string-join (map json ks) ",") "]"))

(define (meta->json m)
  (match m
    ['component "{\"t\":\"component\"}"]
    [(list 'frame base keys item)
     (format "{\"t\":\"frame\",\"p\":~a,\"k\":~a,\"i\":~a}"
             (match base
               ['none "null"]
               [(list 'prov n d suffix)
                (format "{\"v\":~a,\"d\":~a,\"k\":~a}" (json (symbol->string n)) d (keys->json suffix))])
             (keys->json keys)
             (if (eq? item 'none) "null" (json item)))]))

(define (meta->string m) (string-append "§" (meta->json m) "§"))

(define (skey? k) (or (exact-nonnegative-integer? k) (string? k)))
(define (skeys? ks) (and (list? ks) (andmap skey? ks)))

;; The inverse on well-formed metadata; #f for any other comment, including
;; look-alikes with an unknown "t" or text that is not JSON.
(define (json->meta j)
  (match j
    [(hash-table ('t "component")) 'component]
    [(hash-table ('t "frame") ('p p) ('k (? skeys? keys)) ('i i))
     (define base
       (match p
         ['null 'none]
         [(hash-table ('v (? string? v)) ('d (? exact-nonnegative-integer? d)) ('k (? skeys? suffix)))
          (list 'prov (string->symbol v) d suffix)]
         [_ #f]))
     (define item (cond [(eq? i 'null) 'none] [(skey? i) i] [else #f]))
     (and base item (list 'frame base keys item))]
    [_ #f]))

(define (string->meta s)
  (and (string-prefix? s "§{") (string-suffix? s "§") (> (string-length s) 2)
       (let ([j (with-handlers ([exn:fail? (λ (_) #f)])
                  (parameterize ([json-null 'null])
                    (string->jsexpr (substring s 1 (sub1 (string-length s))))))])
         (and (hash? j) (json->meta j)))))

(module+ test
  ;; Tags are strings; keys are strings or none.
  (test-equal (redex-match? Core tag (term "p")) #t)
  (test-equal (redex-match? Core key? (term none)) #t)
  (test-equal (redex-match? Core key? (term 1)) #f)

  ;; key and namespace are never props: they have their own slots.
  (test-equal (redex-match? Core prop (term (id "x"))) #t)
  (test-equal (redex-match? Core prop (term (key "k"))) #f)
  (test-equal (redex-match? Core prop (term (namespace "n"))) #f)

  ;; Props hold any runtime value, vnodes, and iterables of those.
  (test-equal (redex-match? Core prop (term (data (rec (a 1))))) #t)
  (test-equal (redex-match? Core prop (term (title (el 0 "b" none none () ())))) #t)
  (test-equal (redex-match? Core prop (term (title (frag "a" (group none ()))))) #t)

  ;; Elements carry a template id, an optional namespace and an optional key.
  (test-equal (redex-match? Core node (term (el 0 "br" none none () ()))) #t)
  (test-equal (redex-match? Core node (term (el 3 "li" none "a" ((class "x")) ((text "a"))))) #t)
  (test-equal (redex-match? Core node (term (group none ((group "a" ()))))) #t)
  (test-equal (redex-match? Core node (term (meta-open (frame none ("items") 0)))) #t)
  (test-equal (redex-match? Core node (term meta-close)) #t)
  ;; Children are already normalized.
  (test-equal (redex-match? Core node (term (el 0 "p" none none () ("hi")))) #f)

  ;; make-el sorts props and detects svg and math.
  (test-equal (term (make-el 1 "p" none none ((title "t") (id "x")) ()))
              (term (el 1 "p" none none ((id "x") (title "t")) ())))
  (test-equal (term (make-el 1 "SVG" none none () ()))
              (term (el 1 "svg" ,SVG-NS none () ())))
  (test-equal (term (make-el 1 "Math" none none () ()))
              (term (el 1 "math" ,MATH-NS none () ())))
  (test-equal (term (make-el 1 "g" ,SVG-NS none () ()))
              (term (el 1 "g" ,SVG-NS none () ())))

  ;; Metadata text is what the runtime writes.
  (test-equal (meta->string 'component) "§{\"t\":\"component\"}§")
  (test-equal (meta->string '(frame none ("child") none))
              "§{\"t\":\"frame\",\"p\":null,\"k\":[\"child\"],\"i\":null}§")
  (test-equal (meta->string '(frame (prov sel 0 ("items" 1)) () 2))
              "§{\"t\":\"frame\",\"p\":{\"v\":\"sel\",\"d\":0,\"k\":[\"items\",1]},\"k\":[],\"i\":2}§")
  ;; Parsing inverts it, and rejects look-alike comments.
  (for ([m '(component (frame none ("a") none) (frame none ("items") 0) (frame none () "k")
                       (frame (prov sel 2 ("a" "b" 3)) ("c") none))])
    (test-equal (string->meta (meta->string m)) m))
  (test-equal (string->meta "§/§") #f)
  (test-equal (string->meta "§{\"t\":\"it\"}§") #f)
  (test-equal (string->meta "§{\"t\":\"frame\",\"p\":null,\"k\":[null],\"i\":null}§") #f)
  (test-equal (string->meta "§{not json}§") #f)
  (test-equal (string->meta "ordinary comment") #f)
  (test-results))
