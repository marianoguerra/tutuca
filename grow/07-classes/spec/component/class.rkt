#lang racket
;; Classes: the model half of component(). A class says what state its
;; instances hold.
;;
;; Instances are values, not objects: there is no identity and no inheritance.
(require redex/reduction-semantics "../data.rkt" "expr.rkt" "types.rkt")
(provide Class class-fields make-instance)

(define-extended-language Class Types
  (class-def ::= (class cname csection ...))
  (csection ::= (fields (fname ty) ...)))   ; the schema; without it, fields are not checked

;; The schema, or #f when the class has no fields section.
(define (class-fields def)
  (match def
    [(list 'class _ sections ...)
     (for/first ([s sections] #:when (eq? (first s) 'fields)) (rest s))]))

;; make: an instance from arguments by field name. Each field is made in the
;; order the class declares it, and its owner is the instance so far, so a
;; field can read the ones before it.
(define-metafunction Class
  make-instance : class-def (fname value) ... -> value
  [(make-instance class-def (fname value) ...)
   ,(for/fold ([self (term (comp ,(def-name (term class-def))))])
              ([f (or (class-fields (term class-def)) '())])
      (match-define (list name ty) f)
      (define arg (match (assq name (term ((fname value) ...))) [(list _ v) v] [#f 'absent]))
      (term (prop-set ,self ,name (make-field ,ty ,arg ,self))))])

(module+ test
  (require rackunit)
  (define counter (term (class Counter (fields (n (Refine Number int)) (label (Default String "count"))))))
  (test-equal (redex-match? Class class-def counter) #t)
  (test-equal (class-fields counter) '((n (Refine Number int)) (label (Default String "count"))))
  (test-equal (class-fields '(class C)) #f)

  ;; Fields get their arguments, or their defaults.
  (test-equal (term (make-instance ,counter)) '(comp Counter (n 0) (label "count")))
  (test-equal (term (make-instance ,counter (n 3))) '(comp Counter (n 3) (label "count")))
  ;; An argument that is not valid gives the default; one for no field is dropped.
  (test-equal (term (make-instance ,counter (n 1.5) (other 1))) '(comp Counter (n 0) (label "count")))
  (test-equal (term (comp-class (make-instance ,counter))) 'Counter)

  ;; A field can read the fields before it.
  (define tabs (term (class Tabs (fields (items (Default (Array String) (arr "a" "b"))) (selected (Index items))))))
  (test-equal (term (make-instance ,tabs)) '(comp Tabs (items (arr "a" "b")) (selected 0)))
  (test-equal (term (make-instance ,tabs (selected 1))) '(comp Tabs (items (arr "a" "b")) (selected 1)))
  (test-equal (term (make-instance ,tabs (selected 5))) '(comp Tabs (items (arr "a" "b")) (selected 0)))
  ;; A field with no default is required.
  (check-exn exn:fail? (λ () (term (make-instance ,tabs (items (arr))))))
  (test-results))
