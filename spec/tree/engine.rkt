#lang racket
;; How the tower is put together: define-tier.
;;
;; A tier is a language and the clauses of the engine's metafunctions. The
;; engine is defined once, in core.rkt, as metafunctions over Core; a tier adds
;; clauses to some of them (and may add metafunctions of its own). Redex's
;; define-metafunction/extension can't do this: an extension's inherited clauses
;; call the extended metafunction only when they call themselves, and the
;; engine's metafunctions call each other (acts calls ev, make calls
;; make-slots, ...). So define-tier instantiates every metafunction anew, over
;; the tier's language, with the tier's clauses first and the inherited ones
;; after, in the tier's module. Every call then reaches the tier's version.
;;
;; define-tier also defines, in the tier's module:
;;   the reduction relation (named by #:relation), the same rules in every tier,
;;     with the tier's cfg as its domain: a tier's relation rejects programs
;;     that use a later tier's forms;
;;   own-clauses, how many clauses of each metafunction the tier added (they come
;;     first), for typesetting just those;
;;   make-config, a configuration from a program and a script.
(require redex/reduction-semantics
         (for-syntax racket/base racket/list syntax/parse syntax/strip-context racket/syntax))
(provide define-tier attempt δ lt eq
         config-tree config-queue config-inflight config-script config-obs quiescent? tree-ids)

(begin-for-syntax
  ;; name -> clauses (syntax), newest tier first; names in definition order
  (struct tier-info (clauses names)))

(define-syntax (define-tier stx)
  (syntax-parse stx
    [(_ tier:id lang:id (~optional (~seq #:extends parent:id)) #:relation rel:id
        [mf:id clause ...] ...)
     (define inherited (if (attribute parent) (syntax-local-value #'parent) (tier-info (hash) '())))
     (define own (for/list ([m (syntax->list #'(mf ...))] [cs (syntax->list #'((clause ...) ...))])
                   (cons (syntax-e m) (syntax->list cs))))
     (define names (remove-duplicates (append (tier-info-names inherited) (map car own))))
     (define all
       (for/hash ([n names])
         (values n (append (cond [(assq n own) => cdr] [else '()])
                           (hash-ref (tier-info-clauses inherited) n '())))))
     (with-syntax ([((clauses ...) ...) (for/list ([n names]) (hash-ref all n))]
                   [(stored ...) (for/list ([n names])
                                   #`(cons '#,n (list #,@(for/list ([c (hash-ref all n)])
                                                           #`(quote-syntax #,c)))))]
                   [(name ...) names]
                   [(count ...) (for/list ([n names]) (length (cond [(assq n own) => cdr] [else '()])))])
       ;; The rules, written with plain ellipses: (... template) keeps them from
       ;; being the template's own, and their columns are what the PDF lays out.
       (define/with-syntax rel-def
         #'(...
            (define rel
              (reduction-relation
               lang #:domain cfg
               (--> (config P (world c any_q any_i (event script ...) ν any_o))
                    (config P (env-turn P (world c any_q any_i (script ...) ν any_o) event))
                    env)
               (--> (config P (world c any_q any_i ((one-of event_1 ... event event_2 ...) script ...) ν any_o))
                    (config P (env-turn P (world c any_q any_i (script ...) ν any_o) event))
                    env-choice)
               (--> (config P (world c any_q (message_1 ... message message_2 ...) any_s ν any_o))
                    (config P (arrive P (world c any_q (message_1 ... message_2 ...) any_s ν any_o) message))
                    respond)
               (--> (config P (world c (message message_q ...) any_i any_s ν any_o))
                    (config P (run P (world c (message_q ...) any_i any_s ν any_o) message))
                    run)))))
       ;; Everything is given the context of the tier's module, so the names
       ;; in every clause, inherited or not, refer to its definitions.
       #`(begin
           (define-syntax tier (tier-info (make-immutable-hash (list stored ...)) '(name ...)))
           #,(replace-context
              #'tier
              #'(begin
            (define-metafunction lang clauses ...) ...
            (define own-clauses (hash (~@ 'name count) ...))
            rel-def
            (define (make-config #:kinds kinds #:root k #:host [host '(host ())] #:events [script '()]
                                 #:policy [policy 'by-path] #:gran [gran 'turn])
              (match (term (make ,kinds ,k () 0))
                [(list root next)
                 `(config (program (,policy ,gran) ,kinds ,host) (world ,root () () ,script ,next ()))]))))))]))

;; try(t): t, or failed when t is undefined, which is how the model throws.
(define-syntax-rule (attempt e) (with-handlers ([exn:fail? (λ (_) 'failed)]) e))

;; The primitive operations on values; comparisons give 1 or 0.
(define (lt a b) (if (< a b) 1 0))
(define (eq a b) (if (equal? a b) 1 0))
(define (δ op a b)
  (unless (and (exact-integer? a) (exact-integer? b)) (error 'δ "~a on ~a and ~a" op a b))
  (case op [(+) (+ a b)] [(-) (- a b)] [(<) (lt a b)]))

;; ---- configurations, read from Racket ----------------------------------------
;; (config (program opts kinds host) (world tree queue inflight script next obs))
(define (world c) (third c))
(define (config-tree c) (second (world c)))
(define (config-queue c) (third (world c)))
(define (config-inflight c) (fourth (world c)))
(define (config-script c) (fifth (world c)))
(define (config-obs c) (seventh (world c)))
(define (quiescent? c)
  (and (null? (config-queue c)) (null? (config-inflight c)) (null? (config-script c))))
;; Every instance's identity, wherever in the tree.
(define (tree-ids t)
  (match t
    [(list 'comp _ ι _ slots _ ...) (cons ι (append-map tree-ids (map second slots)))]
    [(list (or 'list 'map) items ...) (append-map (λ (it) (tree-ids (if (and (pair? it) (not (eq? (car it) 'comp))) (second it) it))) items)]
    [_ '()]))
