#lang racket
;; Views: expressions, registration and rendering.
;;
;; A view is a tree of expressions and rendering is evaluating it. Evaluating
;; builds the semantic tree of sem.rkt, and rendering a component makes a
;; wrapper node. How the DOM records that wrapper is bind/lower.rkt's business,
;; not the view's.
;;
;; Element ids: every h node carries its template id tid. Ids are opaque, so
;; only their uniqueness per template matters.
(require redex/reduction-semantics "../data.rkt" "../component/paths.rkt" "../component/expr.rkt"
         "sem.rkt" "normalize.rkt")
(provide View eval eval-attrs render-view render-root root-ctx with-component best-view
         register register-components registration-of split-component
         class-def-of view-def-of classes-of)

(define-extended-language View Norm
  (view-name ::= string)
  ;; The view half of component(): the views of a class.
  (view-def ::= (view-of cname vsection ...))
  (vsection ::= (views (view-name e) ...))
  ;; component({...}) as one form: both halves' sections, in any order.
  (component-def ::= (component cname section ...))
  (section ::= csection vsection)
  (e ::= value snode
         (field fname)                     ; ctx.it[f]
         (h tid tag (attr ...) e ...)      ; h(tag, attrs, ...childs)
         (frag e ...))                     ; several roots
  (attr ::= (prop-name e) (key e) (namespace ns))
  ;; The render context: it, the value expressions read, and the component
  ;; whose view is being evaluated.
  (ctx ::= (rctx value value))
  ;; A registered component: its class and its views.
  (registration ::= (reg cname class-def view-def))
  (registry ::= (registration ...)))

;; ---- registration ----------------------------------------------------------

;; component(): the options split into the class and its views.
(define-metafunction View
  split-component : component-def -> (class-def view-def)
  [(split-component (component cname section ...))
   ((class cname csection ...) (view-of cname vsection ...))
   (where (csection ...) ,(filter (λ (s) (redex-match? View csection s)) (term (section ...))))
   (where (vsection ...) ,(filter (λ (s) (redex-match? View vsection s)) (term (section ...))))])

;; A class must have a main view.
(define-metafunction View
  register : component-def -> registration
  [(register component-def)
   (reg cname class-def (view-of cname vsection ...))
   (where (class-def (view-of cname vsection ...)) (split-component component-def))
   (where ((view-name e) ...) ,(def-section (term (view-of cname vsection ...)) 'views))
   (side-condition (member "main" (term (view-name ...))))])

;; Class names are unique. This is a model restriction: Scope.register
;; overwrites a name silently, and inner scopes shadow outer ones.
(define-metafunction View
  register-components : (component-def ...) -> registry
  [(register-components (component-def ...)) ((register component-def) ...)
   (side-condition (let ([names (map def-name (term (component-def ...)))])
                     (= (length names) (length (remove-duplicates names)))))])

(define-metafunction View
  registration-of : registry cname -> registration
  [(registration-of (any_1 ... (reg cname any ...) any_2 ...) cname) (reg cname any ...)])

(define-metafunction View
  class-def-of : registry value -> class-def
  [(class-def-of registry (comp cname any ...))
   class-def
   (where (reg cname class-def view-def) (registration-of registry cname))])

(define-metafunction View
  view-def-of : registry value -> view-def
  [(view-def-of registry (comp cname any ...))
   view-def
   (where (reg cname class-def view-def) (registration-of registry cname))])

(define-metafunction View
  classes-of : registry -> (class-def ...)
  [(classes-of ((reg cname class-def view-def) ...)) (class-def ...)])

;; ---- render context ------------------------------------------------------

;; RenderContext.root(component)
(define-metafunction View
  root-ctx : registry value -> ctx
  [(root-ctx registry value) (rctx value value)])

(define-metafunction View
  with-component : ctx value -> ctx
  [(with-component (rctx value_it value_c) value) (rctx value_it value)])

;; The view a render uses: main.
(define-metafunction View
  best-view : view-def -> e
  [(best-view view-def) ,(second (lookup-named (def-section (term view-def) 'views) "main"))])

;; ---- evaluation --------------------------------------------------------------

;; renderView: the component's best view, evaluated with it as the component,
;; inside a component wrapper.
(define-metafunction View
  render-view : registry value ctx -> snode
  [(render-view registry (comp cname any ...) ctx)
   (component cname
              (normalize
               (eval registry (with-component ctx (comp cname any ...))
                     (best-view (view-def-of registry (comp cname any ...))))))])

;; Expression attributes in order; key and namespace go to their slots.
(define-metafunction View
  eval-attrs : registry ctx (attr ...) -> ((prop ...) key? ns?)
  [(eval-attrs registry ctx ()) (() none none)]
  [(eval-attrs registry ctx ((key e) attr ...)) ((prop ...) (key-of (eval registry ctx e)) ns?)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))]
  [(eval-attrs registry ctx ((namespace ns) attr ...)) ((prop ...) key? ns)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))]
  [(eval-attrs registry ctx ((prop-name e) attr ...))
   (((prop-name (eval registry ctx e)) prop ...) key? ns?)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))])

(define-metafunction View
  eval : registry ctx e -> result
  [(eval registry ctx value) value]
  [(eval registry ctx snode) snode]
  [(eval registry (rctx value_it any ...) (field fname)) (prop-get value_it fname)]
  [(eval registry ctx (h tid tag (attr ...) e ...))
   (el tid tag ns? key? (prop ...) (snode ... ...))
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))
   (where ((snode ...) ...) ((normalize (eval registry ctx e)) ...))]
  [(eval registry ctx (frag e ...)) (frag (eval registry ctx e) ...)])

;; Host.render: the root component's view, as the container's children.
(define-metafunction View
  render-root : registry value -> (snode ...)
  [(render-root registry value)
   (normalize (render-view registry value (root-ctx registry value)))])

(module+ test
  (require rackunit)
  (define (render classes root) (term (render-root (register-components ,classes) ,root)))
  (define (main-of body) (term ((component Root (views ("main" ,body))))))
  ;; A component wrapper.
  (define (comp-of c . kids) `(component ,c ,kids))
  (define (root-of . kids) `(,(apply comp-of 'Root kids)))

  ;; Literals are views: text, or nothing for null.
  (for ([v '("hello" 42 #f null)])
    (define expected (if (eq? v 'null) '() `((text ,(if (eq? v #f) "false" (format "~a" v))))))
    (test-equal (render (main-of v) '(comp Root)) (apply root-of expected)))

  ;; Elements, with attributes and children.
  (define hello
    (term ((component Hello
             (views ("main" (h 0 "p" ((class "loud") (title "greeting")) "Hello, " (h 1 "b" () "world") "!")))))))
  (test-equal (render hello '(comp Hello))
              `(,(comp-of 'Hello
                          '(el 0 "p" none none ((class "loud") (title "greeting"))
                               ((text "Hello, ") (el 1 "b" none none () ((text "world"))) (text "!"))))))
  ;; Several roots.
  (test-equal (render (main-of '(frag "a" (frag "b" null) (h 0 "i" ()))) '(comp Root))
              (root-of '(text "a") '(text "b") '(el 0 "i" none none () ())))

  ;; Attributes and children read fields.
  (define greeting
    (term ((component Greeting
             (fields (name String))
             (views ("main" (h 0 "p" ((title (field name))) "Hello, " (field name) "!")))))))
  (test-equal (render greeting '(comp Greeting (name "Ada")))
              `(,(comp-of 'Greeting
                          '(el 0 "p" none none ((title "Ada"))
                               ((text "Hello, ") (text "Ada") (text "!"))))))
  ;; A missing field reads as null and renders nothing; a field holding a list
  ;; splices.
  (test-equal (render (main-of '(frag (field missing) (field xs))) '(comp Root (xs (arr "a" 1))))
              (root-of '(text "a") '(text "1")))
  ;; Reading a field of null throws.
  (check-exn exn:fail? (λ () (term (eval () (rctx null null) (field boom)))))

  ;; A class without a main view is rejected, and names are unique.
  (check-exn exn:fail? (λ () (term (register-components ((component C (views ("compact" "x"))))))))
  (check-exn exn:fail? (λ () (term (register-components ((component C (views ("main" "x")))
                                                      (component C (views ("main" "y"))))))))
  ;; The registration splits component() into the class and its views.
  (test-equal (term (split-component (component A (on) (views ("main" "x")) (fields (n Number)))))
              (term ((class A (on) (fields (n Number))) (view-of A (views ("main" "x"))))))
  (define reg (term (register-components ((component A (fields (n Number)) (views ("main" "x")))))))
  (test-equal (term (class-def-of ,reg (comp A (n 0)))) (term (class A (fields (n Number)))))
  (test-equal (term (classes-of ,reg)) (term ((class A (fields (n Number))))))
  ;; A section of neither half is rejected.
  (check-exn exn:fail? (λ () (term (split-component (component A (methods) (views ("main" "x")))))))

  ;; Keys become strings; null keys are no keys; namespace is a slot.
  (test-equal (term (eval () (rctx (rec (id 7)) null) (h 0 "p" ((key (field id)) (namespace "svg-ns")))))
              (term (el 0 "p" "svg-ns" "7" () ())))
  (test-equal (term (eval () (rctx (rec) null) (h 0 "p" ((key (field id))))))
              (term (el 0 "p" none none () ())))
  ;; Nested h calls are element values in props.
  (test-equal (term (eval () (rctx (rec) null) (h 0 "p" ((title (h 1 "b" () "B"))))))
              (term (el 0 "p" none none ((title (el 1 "b" none none () ((text "B"))))) ())))
  ;; Rendering a value that is not a component fails.
  (check-exn exn:fail? (λ () (render (main-of "x") '(rec))))
  (test-results))
