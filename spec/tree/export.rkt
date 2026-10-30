#lang racket
;; Exports the scenarios (scenarios.rkt) for the explorable in demos/tree-spec:
;;   racket spec/tree/export.rkt [out-dir]
;; Each scenario becomes <name>.json, its whole state graph: every reachable
;; configuration and the steps between them, with the rule and what arrived.
;; index.json lists them. Terms become plain JSON the components read
;; (components/tree-spec/model.js).
(require json redex/reduction-semantics racket/runtime-path "engine.rkt" "scenarios.rkt")
(provide scenario->jsexpr state->jsexpr)

(define-runtime-path default-out "../../demos/tree-spec/scenarios")

;; ---- terms --------------------------------------------------------------------
(define (text v) (if (string? v) (format "~s" v) (format "~a" v)))

(define (step->js s)
  (match s
    [`(field ,f) (hasheq 'slot (text f) 'key "" 'text (text f))]
    [`(index ,f ,i) (hasheq 'slot (text f) 'key (text i) 'text (format "~a[~a]" f i))]
    [`(key ,f ,κ) (hasheq 'slot (text f) 'key (text κ) 'text (format "~a[~a]" f (text κ)))]))

(define (addr->js a)
  (match a
    ['host (hasheq 'host #t)]
    [`(at ,π ,ι) (hasheq 'host #f 'path (map step->js π) 'id ι 'anchor (json-null))]
    [`(at ,π ,ι ,ι-sender ,rel)
     (hasheq 'host #f 'path (map step->js π) 'id ι
             'anchor (hasheq 'sender ι-sender 'rel (map step->js rel)))]))

(define (item->js key it)
  (match it
    ['cleared (hasheq 'key key 'cleared #t 'node (json-null))]
    [_ (hasheq 'key key 'cleared #f 'node (inst->js it))]))

(define (slot->js s)
  (match s
    [`(,f (list ,items ...))
     (hasheq 'name (text f) 'type "list"
             'items (for/list ([it items] [i (in-naturals)]) (item->js (text i) it)))]
    [`(,f (map (,κs ,items) ...))
     (hasheq 'name (text f) 'type "map" 'items (for/list ([κ κs] [it items]) (item->js (text κ) it)))]
    [`(,f ,(and c `(comp . ,_))) (hasheq 'name (text f) 'type "field" 'items (list (item->js "" c)))]
    [`(,f ,_) (hasheq 'name (text f) 'type "none" 'items '())]))

(define (inst->js c)
  (match c
    [`(comp ,k ,ι ((,gs ,vs) ...) (,slots ...) . ,rest)
     (hasheq 'kind (text k) 'id ι
             'locals (for/list ([g gs] [v vs]) (hasheq 'name (text g) 'value (text v)))
             'slots (map slot->js slots)
             'control (match rest [(list q) (text q)] [_ ""]))]))

(define (result->js r)
  (match r
    [`(unhandled) (hasheq 'kind "unhandled" 'value "")]
    [`(,kind ,v) (hasheq 'kind (text kind) 'value (text v))]))

(define (msg->js m)
  (match-define `(msg ,mode (,n ,args ...) ,from ,dest) m)
  (define-values (to hop? expected)
    (match dest
      [`(hop ,a) (values a #t (json-null))]
      [`(hop ,a (,ιhs ...)) (values a #t (map text ιhs))]
      [a (values a #f (json-null))]))
  (define-values (kind ρ urg r)
    (match mode
      ['send (values "send" (json-null) 'normal (json-null))]
      ['notify (values "notify" (json-null) 'normal (json-null))]
      [`(request ,ρ ,urg) (values "request" ρ urg (json-null))]
      [`(response ,ρ ,r ,urg) (values "response" ρ urg (result->js r))]))
  (hasheq 'mode kind 'name (text n) 'args (map text args) 'request ρ 'urgent (eq? urg 'urgent)
          'result r 'from (addr->js from) 'to (addr->js to) 'hop hop? 'expected expected))

(define (event->text e)
  (match e
    [`(ev ,pp ,n ,vs ...)
     (format "~a(~a)~a" n (string-join (map text vs) ", ")
             (if (null? pp) "" (format " at ~a" (string-join (map path-text pp) "."))))]
    [`(one-of ,es ...) (format "one of: ~a" (string-join (map event->text es) " | "))]))
(define (path-text s)
  (match s
    [`(field ,f) (text f)]
    [`(sel ,f ,g) (format "~a[~a]" f g)]
    [`(,_ ,f ,v) (format "~a[~a]" f (text v))]))

(define (mode-text mode)
  (match mode
    ['send "send"]
    ['notify "notify"]
    [`(request ,ρ . ,_) (format "request ~a" ρ)]
    [`(response ,ρ ,r . ,_) (format "response ~a" ρ)]))
(define (id-text ι) (if (eq? ι 'host) "the host" (format "#~a" ι)))

;; An observation as a sentence; bad marks what breaks a property.
(define (obs->js o)
  (define-values (sentence bad?)
    (match o
      [`(deliver ,mode ,n ,i ,a)
       (values (format "~a ~a delivered to ~a~a" (mode-text mode) n (id-text a)
                       (if (equal? i a) "" (format ", meant for ~a" (id-text i))))
               (not (equal? i a)))]
      [`(ignored ,mode ,n ,ι) (values (format "~a has no handler for ~a ~a" (id-text ι) (mode-text mode) n)
                                      (match mode [`(response . ,_) #t] [_ #f]))]
      [`(orphaned ,mode ,n ,ι) (values (format "~a ~a for ~a orphaned: it is gone" (mode-text mode) n (id-text ι)) #f)]
      [`(stale ,mode ,n ,ι ,found)
       (values (format "~a ~a for ~a stale: ~a is there now" (mode-text mode) n (id-text ι) (id-text found)) #f)]
      [`(lost ,mode ,n ,ι) (values (format "~a ~a lost on the way up, after ~a" (mode-text mode) n (id-text ι)) #t)]
      [`(hop ,mode ,n ,a ,e)
       (values (format "~a ~a visits ~a~a" (mode-text mode) n (id-text a)
                       (if (equal? a e) "" (format ", expected ~a" (id-text e))))
               (not (equal? a e)))]
      [`(requested ,ρ) (values (format "request ~a sent" ρ) #f)]
      [`(answered ,ρ ,r) (values (format "request ~a answered: ~a" ρ (string-join (map text r) " ")) #f)]
      [`(unhandled ,n) (values (format "nobody stopped ~a" n) #f)]
      [`(failed ,n) (values (format "the transaction for ~a failed" n) #f)]
      [`(no-target ,n) (values (format "event ~a reached nothing" n) #f)]
      [`(log ,v) (values (format "log ~a" (text v)) #f)]))
  (hasheq 'kind (text (car o)) 'text sentence 'bad bad?))

(define (state->jsexpr c)
  (hasheq 'tree (inst->js (config-tree c))
          'queue (map msg->js (config-queue c))
          'inflight (map msg->js (config-inflight c))
          'script (map event->text (config-script c))
          'obs (map obs->js (config-obs c))
          'quiescent (quiescent? c)))

;; ---- the state graph ------------------------------------------------------------
(define (step-label rule from to)
  (match rule
    [(or "env" "env-choice")
     (format "event: ~a" (event->text (car (config-script from))))]
    ["respond"
     (define arrived (for/first ([m (config-inflight from)] #:unless (member m (config-inflight to))) m))
     (match arrived
       [`(msg (response ,ρ ,r ,urg) (,n . ,_) . ,_)
        (format "response ~a to ~a arrives~a" ρ n (if (eq? urg 'urgent) " (urgent, runs now)" ""))]
       [_ "a response arrives"])]
    ["run"
     (match (car (config-queue from))
       [`(msg ,mode (,n . ,_) . ,_) (format "run: ~a ~a" (mode-text mode) n)])]))

(define (scenario->jsexpr s)
  (define rel (scenario-rel s))
  (define c0 (scenario-config s))
  (define index (make-hash (list (cons c0 0))))
  (define states (list c0))
  (define edges '())
  (let loop ([frontier (list c0)])
    (unless (null? frontier)
      (loop
       (for*/list ([c frontier]
                   [r (apply-reduction-relation/tag-with-names rel c)]
                   #:when #t
                   [new? (in-value (not (hash-has-key? index (second r))))]
                   #:when (or new? #t)
                   [_ (in-value (when new?
                                  (hash-set! index (second r) (hash-count index))
                                  (set! states (cons (second r) states))))]
                   [_ (in-value (set! edges (cons (hasheq 'from (hash-ref index c) 'to (hash-ref index (second r))
                                                          'rule (first r)
                                                          'label (step-label (first r) c (second r)))
                                                  edges)))]
                   #:when new?)
         (second r)))))
  (match-define `(config (program (,policy ,gran) ,kinds ,host) ,_) c0)
  (hasheq 'name (scenario-name s) 'tier (scenario-tier s) 'title (scenario-title s)
          'blurb (scenario-blurb s) 'policy (text policy) 'gran (text gran)
          'kinds (for/list ([k kinds]) (pretty-format k 70 #:mode 'write))
          'host (pretty-format host 70 #:mode 'write)
          'states (map state->jsexpr (reverse states))
          'edges (reverse edges)))

(module+ main
  (define out (match (current-command-line-arguments)
                [(vector dir) (string->path dir)]
                [_ default-out]))
  (make-directory* out)
  (define entries
    (for/list ([s scenarios])
      (define js (scenario->jsexpr s))
      (call-with-output-file (build-path out (format "~a.json" (scenario-name s))) #:exists 'replace
        (λ (port) (write-json js port)))
      (printf "~a: ~a states\n" (scenario-name s) (length (hash-ref js 'states)))
      (hasheq 'name (scenario-name s) 'tier (scenario-tier s) 'title (scenario-title s)
              'policy (hash-ref js 'policy) 'gran (hash-ref js 'gran))))
  (call-with-output-file (build-path out "index.json") #:exists 'replace
    (λ (port) (write-json entries port))))
