#lang racket
;; Metadata comments: how the DOM records the semantic tree's wrappers
;; (wrapMeta in view.js, parseMeta in meta.js).
;;
;; A wrapper becomes an opening comment before its children and the closing
;; comment §/§ after them. The opening comment says what the wrapper is: a
;; component boundary, or one path frame. A frame's cf flag is not written:
;; routing restores it from the component boundary that follows.
(require redex/reduction-semantics json "../component/paths.rkt")
(provide Meta meta->string string->meta META-CLOSE frame-meta meta-frame)

(define-extended-language Meta Paths
  (meta ::= component (frame base (skey ...) item?)))

(define META-CLOSE "§/§")

;; Metadata drops cf: the component boundary that follows says it.
(define-metafunction Meta
  frame-meta : dframe -> meta
  [(frame-meta (frame base any_k item? boolean)) (frame base any_k item?)])

(define-metafunction Meta
  meta-frame : meta -> dframe
  [(meta-frame (frame base any_k item?)) (frame base any_k item? #f)])

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
  (require rackunit)
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
  (test-equal (string->meta META-CLOSE) #f)
  (test-equal (string->meta "§{\"t\":\"it\"}§") #f)
  (test-equal (string->meta "§{\"t\":\"frame\",\"p\":null,\"k\":[null],\"i\":null}§") #f)
  (test-equal (string->meta "§{not json}§") #f)
  (test-equal (string->meta "ordinary comment") #f)

  ;; Frames round trip through their text; cf comes back from promotion.
  (define jump (term (frame (prov sel 0 ("items" 1)) () none #t)))
  (for ([f (term ((frame none ("a") none #t) (frame none ("xs") 0 #f) (frame ,(second jump) () 4 #f)))])
    (define parsed (term (meta-frame ,(string->meta (meta->string (term (frame-meta ,f)))))))
    (test-equal (if (fifth f) (term (promote (,parsed))) (list parsed)) (list f)))
  (test-results))
