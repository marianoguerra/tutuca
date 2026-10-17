#lang racket
;; Views: expressions, registration and rendering (tutuca.js AstNodes,
;; ComponentSpec, RenderContext, renderView).
;;
;; A view is a tree of expressions and rendering is evaluating it: every
;; template node has one eval method. Evaluating h builds a Core element now,
;; so attribute and child positions receive the same runtime values.
;;
;; Erased optimizations (src/optimize.js): reuseConstant's shared vnodes,
;; prebuilt literal texts, the static/dynamic attribute split and the shared
;; closing comment. Each builds an equal vnode, so eval builds it plainly.
;;
;; Element ids: in the runtime DomNode takes a fresh eid from a module counter
;; when it has handlers, and planElement adds it as the static data-eid attr.
;; Here every h node carries its template id tid, which is also its Shape (see
;; core.rkt); an element with handlers renders data-eid = tid. Ids are opaque,
;; so only their uniqueness per template matters.
(require redex/reduction-semantics "data.rkt" "core.rkt" "normalize.rkt" "paths.rkt" "host.rkt")
(provide add-entry attr-exprs on-attrs register merge-dyn for-item-view with-component best-view-in bind-of lookup-dyn eid-props loop-opt eval-each eval-item eval-body
         View eval eval-attrs to-frame render-view render-root root-ctx enter-frame
         best-view collect collect-all register-classes registration-of
         class-def-of handlers-for)

(define-extended-language View Host
  (result ::= value node (frag result ...))
  (bname ::= variable)
  (e ::= value node
         (field fname)                     ; ctx.it[f]
         (seq-item fname fname)            ; ctx.it[s][ctx.it[k]]
         (provided fname)                  ; the value an ancestor provides
         (lookup-bind bname)               ; a loop or scope bind
         (if e e e)                        ; $if
         (h tid tag (attr ...) e ...)      ; h(tag, attrs, ...childs)
         (frag e ...)                      ; a custom node returning several roots
         (x-render src view-name?)         ; render(source, viewName)
         (each src e loop-name?)           ; each(source, body, loopName)
         (render-each src loop-name?)      ; renderEach(source, loopName)
         (render-it view-name?)            ; renderIt(viewName)
         (scope fname e)                   ; scope(scopeName, body)
         (push-view e e))                  ; pushView(viewName, body)
  ;; Sources a step can be taken from (toStep).
  (src ::= (field fname) (seq-item fname fname) (provided fname))
  (loop-name? ::= fname none)
  (attr ::= (prop-name e) (key e) (namespace ns) on-attr)
  (on-attr ::= (on fname action))          ; "@on.<event>": action
  ;; Send arguments are evaluated on dispatch, against the message context:
  ;; literals, the event target's value, the source key, or conditionals of
  ;; those. Lint rejects state reads and render binds there.
  (action ::= (send fname arg ...))
  (arg ::= value (target-value) (source-key) (if arg arg arg))
  ;; RenderContext: it, binds, dynBinds, viewStack, depth, component.
  (ctx ::= (rctx value binds dyn (value ...) integer value))
  (binds ::= ((bname value) ...))
  (dyn ::= ((fname value natural upath) ...))
  ;; ComponentSpec after registration: views, the eid -> handlers table built
  ;; by Collect, and the definition (on, loops, scopes, provides).
  (table ::= ((tid (on-attr ...)) ...))
  (registration ::= (reg cname table class-def))
  (registry ::= (registration ...)))

;; ---- registration ----------------------------------------------------------

;; An id is entered once; a template shared across views meets its own entry.
(define-metafunction View
  add-entry : tid (on-attr ...) table -> table
  [(add-entry tid () table) table]
  [(add-entry tid (on-attr ...) (any_1 ... (tid (on-attr ...)) any_2 ...))
   (any_1 ... (tid (on-attr ...)) any_2 ...)]
  [(add-entry tid (on-attr ...) ((tid_t any_t) ...)) ((tid_t any_t) ... (tid (on-attr ...)))
   (side-condition (not (member (term tid) (term (tid_t ...)))))])

(define-metafunction View
  attr-exprs : (attr ...) -> (e ...)
  [(attr-exprs ()) ()]
  [(attr-exprs ((on fname action) attr ...)) (attr-exprs (attr ...))]
  [(attr-exprs ((namespace ns) attr ...)) (attr-exprs (attr ...))]
  [(attr-exprs ((any e) attr ...)) (e e_rest ...)
   (where (e_rest ...) (attr-exprs (attr ...)))])

(define-metafunction View
  on-attrs : (attr ...) -> (on-attr ...)
  [(on-attrs (attr ...)) ,(filter (λ (a) (eq? (first a) 'on)) (term (attr ...)))])

;; Collect, a Walker: an element's entry, then its attribute expressions in
;; order, then its children. Action arguments hold no elements: not walked.
(define-metafunction View
  collect : e table -> table
  [(collect (h tid tag (attr ...) e ...) table)
   (collect-all (e_a ... e ...) (add-entry tid (on-attrs (attr ...)) table))
   (where (e_a ...) (attr-exprs (attr ...)))]
  [(collect (if e_c e_t e_e) table) (collect-all (e_c e_t e_e) table)]
  [(collect (frag e ...) table) (collect-all (e ...) table)]
  [(collect (each src e loop-name?) table) (collect e table)]
  [(collect (scope fname e) table) (collect e table)]
  [(collect (push-view e_v e) table) (collect-all (e_v e) table)]
  [(collect e table) table])

(define-metafunction View
  collect-all : (e ...) table -> table
  [(collect-all () table) table]
  [(collect-all (e_1 e ...) table) (collect-all (e ...) (collect e_1 table))])

;; component(): a class must have a main view; one table covers all views.
(define-metafunction View
  register : class-def -> registration
  [(register (class cname section_1 ... (views (view-name e) ...) section_2 ...))
   (reg cname (collect-all (e ...) ()) (class cname section_1 ... (views (view-name e) ...) section_2 ...))
   (side-condition (member "main" (term (view-name ...))))])

;; Scope.register: class names are unique.
(define-metafunction View
  register-classes : (class-def ...) -> registry
  [(register-classes (class-def ...)) ((register class-def) ...)
   (side-condition (let ([names (map class-name (term (class-def ...)))])
                     (= (length names) (length (remove-duplicates names)))))])

(define-metafunction View
  registration-of : registry cname -> registration
  [(registration-of (any_1 ... (reg cname table class-def) any_2 ...) cname) (reg cname table class-def)])

(define-metafunction View
  class-def-of : registry value -> class-def
  [(class-def-of registry (comp cname any ...))
   class-def
   (where (reg cname table class-def) (registration-of registry cname))])

(define-metafunction View
  handlers-for : registry cname tid -> (on-attr ...)
  [(handlers-for registry cname tid)
   ,(let ([e (assoc (term tid) (term table))]) (if e (second e) '()))
   (where (reg cname table class-def) (registration-of registry cname))])

;; ---- render context ------------------------------------------------------

;; enterFrame: advance one path frame and capture providers at its depth.
(define-metafunction View
  enter-frame : registry ctx value binds -> ctx
  [(enter-frame registry (rctx value_it binds_old dyn (value_v ...) integer value_c) value binds)
   (rctx value binds (merge-dyn registry dyn value integer_d) (value_v ...) integer_d value_c)
   (where integer_d ,(add1 (term integer)))])

;; mergeDynBinds: a component's provides, frozen against it, shadow outer ones.
(define-metafunction View
  merge-dyn : registry dyn value natural -> dyn
  [(merge-dyn registry dyn (comp cname any ...) natural)
   ,(for/fold ([dyn (term dyn)]) ([p (class-section (term class-def) 'provides)])
      (match-define (list name sel) p)
      (define suffix (term (resolve (freeze-sel ,sel (comp cname any ...)))))
      (define v (term (get-in ,suffix (comp cname any ...))))
      (cons (list name v (term natural) suffix)
            (filter (λ (d) (not (eq? (first d) name))) dyn)))
   (where class-def (class-def-of registry (comp cname any ...)))]
  [(merge-dyn registry dyn value natural) dyn])

;; RenderContext.root(component)
(define-metafunction View
  root-ctx : registry value -> ctx
  [(root-ctx registry value) (enter-frame registry (rctx null () () () -1 value) value ())])

;; forItemView: each already entered this item and captured its providers.
(define-metafunction View
  for-item-view : ctx value -> ctx
  [(for-item-view (rctx value_it binds dyn any_v integer value_c) value)
   (rctx value () dyn any_v integer value_c)])

(define-metafunction View
  with-component : ctx value -> ctx
  [(with-component (rctx value_it binds dyn any_v integer value_c) value)
   (rctx value_it binds dyn any_v integer value)])

;; getBestViewFor: the explicit name, then the view stack, then main.
(define-metafunction View
  best-view : class-def view-name? (value ...) -> e
  [(best-view class-def view-name (value ...)) (best-view-in class-def (view-name value ...))]
  [(best-view class-def none (value ...)) (best-view-in class-def (value ...))])

(define-metafunction View
  best-view-in : class-def (value ...) -> e
  [(best-view-in class-def ()) ,(second (lookup-named (class-section (term class-def) 'views) "main"))]
  [(best-view-in class-def (value_0 value ...))
   ,(second (lookup-named (class-section (term class-def) 'views) (term value_0)))
   (side-condition (lookup-named (class-section (term class-def) 'views) (term value_0)))]
  [(best-view-in class-def (value_0 value ...)) (best-view-in class-def (value ...))])

(define-metafunction View
  bind-of : binds bname -> value
  [(bind-of (any_1 ... (bname value) any_2 ...) bname) value
   (side-condition (not (assq (term bname) (term (any_1 ...)))))]
  [(bind-of binds bname) null])

(define-metafunction View
  lookup-dyn : dyn fname -> (value natural upath)
  [(lookup-dyn (any_1 ... (fname value natural upath) any_2 ...) fname) (value natural upath)
   (side-condition (not (assq (term fname) (term (any_1 ...)))))])

;; ---- evaluation --------------------------------------------------------------

(define (meta-wrap m r) (term (frag (meta-open ,m) ,r meta-close)))

;; The frame a render source enters: a field, the selected item of a field,
;; or a provider jump. A provided source with no provider fails.
(define-metafunction View
  to-frame : ctx src -> dframe
  [(to-frame ctx (field fname)) (frame none (,(symbol->string (term fname))) none #t)]
  [(to-frame (rctx value_it any ...) (seq-item fname fname_k))
   (frame none (,(symbol->string (term fname))) (prop-get value_it fname_k) #t)]
  [(to-frame (rctx value_it binds dyn any_v integer value_c) (provided fname))
   (frame (prov fname natural upath) () none #t)
   (where (value natural upath) (lookup-dyn dyn fname))])

;; renderView: the component's best view, evaluated with it as the component,
;; between balanced component metadata.
(define-metafunction View
  render-view : registry value ctx view-name? -> result
  [(render-view registry value (rctx value_it binds dyn (value_v ...) integer value_c) view-name?)
   ,(meta-wrap 'component
               (term (eval registry (with-component (rctx value_it binds dyn (value_v ...) integer value_c) value)
                           (best-view (class-def-of registry value) view-name? (value_v ...)))))])

;; Expression attributes in order; key and namespace go to their slots and
;; handlers never render.
(define-metafunction View
  eval-attrs : registry ctx (attr ...) -> ((prop ...) key? ns?)
  [(eval-attrs registry ctx ()) (() none none)]
  [(eval-attrs registry ctx ((key e) attr ...)) ((prop ...) (key-of (eval registry ctx e)) ns?)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))]
  [(eval-attrs registry ctx ((namespace ns) attr ...)) ((prop ...) key? ns)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))]
  [(eval-attrs registry ctx (on-attr attr ...)) (eval-attrs registry ctx (attr ...))]
  [(eval-attrs registry ctx ((prop-name e) attr ...))
   (((prop-name (eval registry ctx e)) prop ...) key? ns?)
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))])

(define-metafunction View
  eid-props : tid (attr ...) -> (prop ...)
  [(eid-props tid (attr ...)) () (where () (on-attrs (attr ...)))]
  [(eid-props tid (attr ...)) ((data-eid tid))])

(define-metafunction View
  loop-opt : class-def loop-name? any -> any
  [(loop-opt class-def none any) #f]
  [(loop-opt class-def fname any)
   ,(let ([o (assq (term any) (rest (lookup-named (class-section (term class-def) 'loops) (term fname))))])
      (and o (second o)))])

(define-metafunction View
  eval : registry ctx e -> result
  [(eval registry ctx value) value]
  [(eval registry ctx node) node]
  [(eval registry (rctx value_it any ...) (field fname)) (prop-get value_it fname)]
  [(eval registry (rctx value_it any ...) (seq-item fname fname_k))
   (prop-get (prop-get value_it fname) (prop-get value_it fname_k))]
  [(eval registry (rctx value_it binds dyn any_v integer value_c) (provided fname))
   ,(let ([d (assq (term fname) (term dyn))]) (if d (second d) 'null))]
  [(eval registry (rctx value_it binds any ...) (lookup-bind bname)) (bind-of binds bname)]
  [(eval registry ctx (if e_c e_t e_e)) (eval registry ctx e_t)
   (side-condition (truthy? (term (eval registry ctx e_c))))]
  [(eval registry ctx (if e_c e_t e_e)) (eval registry ctx e_e)]
  [(eval registry ctx (h tid tag (attr ...) e ...))
   (make-el tid tag ns? key? (prop ... prop_eid ...) (node ... ...))
   (where ((prop ...) key? ns?) (eval-attrs registry ctx (attr ...)))
   (where (prop_eid ...) (eid-props tid (attr ...)))
   (where ((node ...) ...) ((normalize (eval registry ctx e)) ...))]
  [(eval registry ctx (frag e ...)) (frag (eval registry ctx e) ...)]
  [(eval registry ctx (x-render src view-name?))
   ,(meta-wrap (term (frame-meta (to-frame ctx src)))
               (term (render-view registry value (enter-frame registry ctx value ()) view-name?)))
   (where value (eval registry ctx src))]
  [(eval registry ctx (each src e loop-name?)) (eval-each registry ctx src e loop-name?)]
  [(eval registry ctx (render-each src loop-name?)) (eval-each registry ctx src render-each loop-name?)]
  [(eval registry (rctx value_it binds any ...) (render-it view-name?))
   (render-view registry value (for-item-view (rctx value_it binds any ...) value) view-name?)
   (where value (bind-of binds value))]
  [(eval registry (rctx value_it binds dyn any_v integer value_c) (scope fname e))
   (eval registry (rctx value_it ((bname value) ... any_b ...) dyn any_v integer value_c) e)
   (where (any_b ...) binds)
   (where (fname hx) ,(lookup-named (class-section (term (class-def-of registry value_c)) 'scopes)
                                    (term fname)))
   (where (rec (bname value) ...)
          ,(match (term (eval-hx ((self value_c)) hx))
             [(list 'rec fs ...) `(rec ,@(filter (λ (f) (not (eq? (first f) 'value))) fs))]))]
  [(eval registry (rctx value_it binds dyn (value_v ...) integer value_c) (push-view e_v e))
   (eval registry (rctx value_it binds dyn (value_n value_v ...) integer value_c) e)
   (where value_n (eval registry (rctx value_it binds dyn (value_v ...) integer value_c) e_v))])

;; XEach/XRenderEach: one keyed group per entry, its item metadata around the
;; body; the loop's hooks pick entries, keys and extra binds.
(define-metafunction View
  eval-each : registry ctx src any loop-name? -> result
  [(eval-each registry (rctx value_it any_r ...) src any_body loop-name?)
   (group none ,(for/list ([entry (term (entries-of (eval registry ctx src)))]
                           #:when (keep? (term class-def) (term loop-name?) entry))
                  (term (eval-item registry ctx class-def dframe src any_body loop-name? ,entry))))
   (where ctx (rctx value_it any_r ...))
   (where (rctx any_i ... value_c) ctx)
   (where class-def (class-def-of registry value_c))
   (where dframe (to-frame ctx src))])

(define (keep? def loop entry)
  (define f (term (loop-opt ,def ,loop filter)))
  (or (not f)
      (truthy? (term (eval-hx ((key ,(first entry)) (value ,(second entry))) ,f)))))

(define-metafunction View
  eval-item : registry ctx class-def dframe src any loop-name? (skey value) -> node
  [(eval-item registry ctx class-def dframe src any_body loop-name? (skey value))
   (group (key-of value_key)
          (normalize (frag (meta-open (frame-meta (item-frame dframe skey))) result meta-close)))
   (where (rctx any_i ... value_c) ctx)
   (where value_key ,(item-key (term class-def) (term loop-name?) (term skey) (term value) (term value_c)))
   (where binds ,(item-binds (term class-def) (term loop-name?) (term skey) (term value) (term value_c)))
   (where ctx_item (enter-frame registry ctx value binds))
   (where result (eval-body registry ctx_item class-def any_body loop-name?))])

;; loop.key(key, value) or the entry key
(define (item-key def loop k v self)
  (define f (term (loop-opt ,def ,loop key)))
  (if f (term (eval-hx ((key ,k) (value ,v) (self ,self)) ,f)) k))

;; {...loop.enrich(base), value, key}
(define (item-binds def loop k v self)
  (define base (list (list 'value v) (list 'key k)))
  (define f (term (loop-opt ,def ,loop enrich)))
  (define extra (if f
                    (match (term (eval-hx ((base (rec ,@base)) (self ,self)) ,f))
                      [(list 'rec fs ...) fs])
                    '()))
  (append base (filter (λ (b) (not (memq (first b) '(value key)))) extra)))

(define-metafunction View
  eval-body : registry ctx class-def any loop-name? -> result
  [(eval-body registry (rctx value_it any_r ...) class-def render-each loop-name?)
   (render-view registry value_it (for-item-view (rctx value_it any_r ...) value_it)
                ,(or (term (loop-opt class-def loop-name? view)) 'none))]
  [(eval-body registry ctx class-def e loop-name?) (eval registry ctx e)])

;; Host.render: the root component's view, as the container's children.
(define-metafunction View
  render-root : registry value -> (node ...)
  [(render-root registry value)
   (normalize (render-view registry value (root-ctx registry value) none))])

(module+ test
  (require rackunit)
  (define (render classes root) (term (render-root (register-classes ,classes) ,root)))
  (define (main-of body) (term ((class Root (views ("main" ,body))))))
  (define C '(meta-open component))

  ;; Literals work in every expression body (view-semantics.test.js).
  (for ([v '("hello" 42 #f null)])
    (define expected (if (eq? v 'null) '() `((text ,(if (eq? v #f) "false" (format "~a" v))))))
    (for ([body `(,v (if #t ,v "wrong") (if #f "wrong" ,v) (push-view "compact" ,v))])
      (test-equal (render (main-of body) '(comp Root)) `(,C ,@expected meta-close))))

  ;; Truthiness picks the branch; only the chosen branch is evaluated (the
  ;; other one would throw: null[k]).
  (for ([v '(#f 0 "" null +nan.0)])
    (test-equal (term (eval () (rctx null () () () 0 null) (if ,v (field boom) "selected"))) "selected"))
  (for ([v '(#t 1 "false" (rec))])
    (test-equal (term (eval () (rctx null () () () 0 null) (if ,v "selected" (field boom)))) "selected"))

  ;; Attributes and children read fields, and $if selects values.
  (define greeting
    (term ((class Greeting
             (views ("main" (h 0 "p" ((class (if (field loud) "loud" "quiet")) (title (field name)))
                               "Hello, " (field name) "!")))))))
  (test-equal (render greeting '(comp Greeting (name "Ada") (loud #t)))
              `(,C (el 0 "p" none none ((class "loud") (title "Ada"))
                       ((text "Hello, ") (text "Ada") (text "!")))
                   meta-close))

  ;; A class without a main view is rejected; view names are own entries only.
  (check-exn exn:fail? (λ () (term (register-classes ((class C (views ("compact" "x"))))))))
  (check-exn exn:fail? (λ () (term (register-classes ((class C (views ("main" "x")))
                                                      (class C (views ("main" "y"))))))))

  ;; Handlers never render; an element with handlers renders data-eid.
  (test-equal (render (main-of '(h 4 "button" ((on click (send go)) (class "b")) "ok")) '(comp Root))
              `(,C (el 4 "button" none none ((class "b") (data-eid 4)) ((text "ok"))) meta-close))

  ;; Registration: one table per class, parents before children, every branch,
  ;; attribute values included; a shared template keeps one entry.
  (define shared '(h 8 "button" ((on click (send shared))) "S"))
  (define reg (term (register-classes
                     ((class A (views ("main" (h 7 "div" ((on click (send a))
                                                           (title (if #t (h 1 "i" ((on click (send yes)))) null)))
                                                  ,shared))
                                      ("compact" (h 2 "section" () ,shared))))))))
  (test-equal reg
              (term ((reg A ((7 ((on click (send a)))) (1 ((on click (send yes)))) (8 ((on click (send shared)))))
                          ,(fourth (first reg))))))
  ;; One id never stands for two handler lists.
  (check-exn exn:fail? (λ () (term (collect (frag (h 1 "b" ((on click (send x))))
                                                  (h 1 "i" ((on click (send y))))) ()))))

  ;; Keys evaluate before stringification; null keys are no keys; namespace is a slot.
  (test-equal (term (eval () (rctx (rec (id 7)) () () () 0 null)
                          (h 0 "p" ((key (field id)) (namespace ,SVG-NS)) )))
              (term (el 0 "p" ,SVG-NS "7" () ())))
  (test-equal (term (eval () (rctx (rec) () () () 0 null) (h 0 "p" ((key (field id))))))
              (term (el 0 "p" none none () ())))
  ;; Nested h calls are vnode values in props.
  (test-equal (term (eval () (rctx (rec) () () () 0 null) (h 0 "p" ((title (h 1 "b" () "B"))))))
              (term (el 0 "p" none none ((title (el 1 "b" none none () ((text "B"))))) ())))

  ;; Components render inside field metadata, with their own state.
  (define classes
    (term ((class User (views ("main" (h 1 "span" () (field name)))))
           (class Todo (views ("main" (h 2 "li" () (field title) (x-render (field owner) none)))
                              ("title" (h 3 "b" () (field title))))))))
  (test-equal (render (append classes (main-of '(x-render (field todo) none)))
                      '(comp Root (name "Parent") (todo (comp Todo (title "T") (owner (comp User))))))
              `(,C (meta-open (frame none ("todo") none)) ,C
                   (el 2 "li" none none () ((text "T") (meta-open (frame none ("owner") none)) ,C
                                            (el 1 "span" none none () ()) meta-close meta-close))
                   meta-close meta-close meta-close))
  ;; A named view, the view stack, and the fallback to main.
  (test-equal (render (append classes (main-of '(x-render (field todo) "title")))
                      '(comp Root (todo (comp Todo (title "T")))))
              `(,C (meta-open (frame none ("todo") none)) ,C (el 3 "b" none none () ((text "T"))) meta-close meta-close meta-close))
  (test-equal (render (append classes (main-of '(push-view "title" (x-render (field todo) "nope"))))
                      '(comp Root (todo (comp Todo (title "T")))))
              `(,C (meta-open (frame none ("todo") none)) ,C (el 3 "b" none none () ((text "T"))) meta-close meta-close meta-close))
  (test-equal (render (append classes (main-of '(push-view "nope" (x-render (field todo) none))))
                      '(comp Root (todo (comp Todo (title "T") (owner (comp User (name "U")))))))
              (render (append classes (main-of '(x-render (field todo) none)))
                      '(comp Root (todo (comp Todo (title "T") (owner (comp User (name "U"))))))))
  ;; Rendering a non-component fails.
  (check-exn exn:fail? (λ () (render (append classes (main-of '(x-render (field todo) none))) '(comp Root))))

  ;; seqItem renders the selected item under item metadata.
  (test-equal (render (append classes (main-of '(x-render (seq-item users sel) none)))
                      '(comp Root (sel 1) (users (arr (comp User (name "a")) (comp User (name "b"))))))
              `(,C (meta-open (frame none ("users") 1)) ,C (el 1 "span" none none () ((text "b")))
                   meta-close meta-close meta-close))

  ;; each: one keyed group per entry, with item metadata and binds.
  (define list-classes
    (term ((class Root
             (views ("main" (each (field items) (h 1 "i" () (lookup-bind key) (field name)) byName)))
             (loops (byName (key (get value name)) (filter (not (= key 1)))))))))
  (test-equal (render list-classes '(comp Root (items (arr (rec (name "a")) (rec (name "b")) (rec (name "c"))))))
              `(,C (group none
                          ((group "a" ((meta-open (frame none ("items") 0))
                                       (el 1 "i" none none () ((text "0") (text "a"))) meta-close))
                           (group "c" ((meta-open (frame none ("items") 2))
                                       (el 1 "i" none none () ((text "2") (text "c"))) meta-close))))
                   meta-close))
  ;; Without a loop, keys are the entry keys; records iterate their entries.
  (test-equal (render (main-of '(each (field r) (lookup-bind value) none)) '(comp Root (r (rec (x 1)))))
              `(,C (group none ((group "x" ((meta-open (frame none ("r") "x")) (text "1") meta-close))))
                   meta-close))
  ;; enrich adds binds, but value and key always win.
  (test-equal (render (term ((class Root (views ("main" (each (field xs) (frag (lookup-bind double) (lookup-bind value)) e)))
                                         (loops (e (enrich (mk-rec (double (+ (get base value) (get base value))) (value 0))))))))
                      '(comp Root (xs (arr 2))))
              `(,C (group none ((group "0" ((meta-open (frame none ("xs") 0)) (text "4") (text "2") meta-close))))
                   meta-close))

  ;; renderEach and renderIt render items with their own views.
  (define items (term ((class Item (views ("main" (h 1 "b" () (field n))) ("row" (h 2 "tr" () (field n))))))))
  (define two '(arr (comp Item (n 1)) (comp Item (n 2))))
  (define (item-meta k) `(meta-open (frame none ("xs") ,k)))
  (test-equal (render (append items (term ((class Root (views ("main" (render-each (field xs) rows)))
                                                 (loops (rows (view "row")))))))
                      `(comp Root (xs ,two)))
              `(,C (group none ((group "0" (,(item-meta 0) ,C (el 2 "tr" none none () ((text "1"))) meta-close meta-close))
                                (group "1" (,(item-meta 1) ,C (el 2 "tr" none none () ((text "2"))) meta-close meta-close))))
                   meta-close))
  (test-equal (render (append items (main-of '(each (field xs) (render-it "row") none))) `(comp Root (xs ,two)))
              (render (append items (term ((class Root (views ("main" (render-each (field xs) rows)))
                                                 (loops (rows (view "row")))))))
                      `(comp Root (xs ,two))))

  ;; scope: binds from the component; its value bind is dropped.
  (test-equal (render (term ((class Root (views ("main" (scope s (frag (lookup-bind label) (lookup-bind value)))))
                                         (scopes (s (mk-rec (label (get self title)) (value "dropped")))))))
                      '(comp Root (title "T")))
              `(,C (text "T") meta-close))

  ;; provided: the provider's frozen path, captured at its depth.
  (define prov
    (term ((class Child (views ("main" (h 1 "i" () (field n)))))
           (class Panel (views ("main" (frag (provided sel) (x-render (provided sel) none))))
                  (provides (sel ((pb-seq-item items selected))))))))
  (define panel '(comp Panel (selected 1) (items (arr (comp Child (n "a")) (comp Child (n "b"))))))
  (test-equal (render prov panel)
              `(,C (text "[object Object]")
                   (meta-open (frame (prov sel 0 ("items" 1)) () none))
                   ,C (el 1 "i" none none () ((text "b"))) meta-close meta-close
                   meta-close))
  ;; No provider: reading gives null, rendering fails.
  (test-equal (render (main-of '(provided nope)) '(comp Root)) `(,C meta-close))
  (check-exn exn:fail? (λ () (render (main-of '(x-render (provided nope) none)) '(comp Root))))
  (test-results))
