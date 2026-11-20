#lang racket
;; Metadata comments: how the DOM records the semantic tree's wrappers.
;;
;; A wrapper becomes an opening comment before its children and the closing
;; comment §/§ after them. The opening comment says what the wrapper is: a
;; component boundary.
(require redex/reduction-semantics json "../component/paths.rkt")
(provide Meta meta->string string->meta META-CLOSE)

(define-extended-language Meta Paths
  (meta ::= component))

(define META-CLOSE "§/§")

;; ---- metadata comment text ------------------------------------------------
;; JSON.stringify of the meta objects, with the runtime's key order.
(define (meta->json m)
  (match m
    ['component "{\"t\":\"component\"}"]))

(define (meta->string m) (string-append "§" (meta->json m) "§"))

;; The inverse on well-formed metadata; #f for any other comment, including
;; look-alikes with an unknown "t" or text that is not JSON.
(define (json->meta j)
  (match j
    [(hash-table ('t "component")) 'component]
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
  ;; Parsing inverts it, and rejects look-alike comments.
  (test-equal (string->meta (meta->string 'component)) 'component)
  (test-equal (string->meta META-CLOSE) #f)
  (test-equal (string->meta "§{\"t\":\"it\"}§") #f)
  (test-equal (string->meta "§{not json}§") #f)
  (test-equal (string->meta "ordinary comment") #f)
  (test-results))
