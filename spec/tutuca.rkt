#lang racket
;; The whole model, and end-to-end scenarios ported from the JS test suite.
;; Each scenario names the test it mirrors; both sides must agree.
(require redex/reduction-semantics
         "data.rkt" "core.rkt" "normalize.rkt" "dom.rkt" "keys.rkt" "morph.rkt"
         "paths.rkt" "host.rkt" "view.rkt" "routing.rkt" "tasks.rkt")
(provide (all-from-out "data.rkt" "core.rkt" "normalize.rkt" "dom.rkt" "keys.rkt" "morph.rkt"
                       "paths.rkt" "host.rkt" "view.rkt" "routing.rkt" "tasks.rkt"))

(module+ test
  (require rackunit)

  ;; ---- driving the host ----------------------------------------------------
  (define (doms c) (term (erase-all ,(cfg-dom c))))
  (define (with-root c root) (list-set c 3 root))
  (define (with-events c events) (list-set c 9 events))
  (define (failures c) (filter (λ (o) (and (pair? o) (eq? (car o) 'failed))) (cfg-obs c)))
  ;; Click the given targets, routing each now, without running tasks.
  (define (queue-events c . addrs)
    (deliver (with-events c (for/list ([a addrs]) `(event click ,a null))) (length addrs)))
  ;; After a drain the DOM is the render of the root (the render invariant).
  (define (click c addr)
    (define c1 (drain (queue-events c addr)))
    (test-equal (doms c1) (term (render (render-root ,(second c1) ,(cfg-root c1)))))
    c1)
  (define (addrs-where c pred) (addresses (doms c) pred))
  (define (by-tag t) (λ (d) (equal? (third d) t)))
  (define (by-id id) (λ (d) (member `(id ,id) (fourth d))))
  (define (addr-of c pred) (first (addrs-where c pred)))
  ;; The address of the element whose node identity is lbl.
  (define (addr-of-label c lbl)
    (let find ([ds (cfg-dom c)] [prefix '()])
      (for/or ([d ds] [i (in-naturals)])
        (match d
          [(list 'element (== lbl) _ _ _ _) (append prefix (list i))]
          [(list 'element _ _ _ _ kids) (find kids (append prefix (list i)))]
          [_ #f]))))
  (define (label-at c addr)
    (let loop ([ds (cfg-dom c)] [addr addr])
      (define d (list-ref ds (car addr)))
      (if (null? (cdr addr)) (second d) (loop (sixth d) (cdr addr)))))
  (define (get c . keys)
    (for/fold ([v (cfg-root c)]) ([k keys]) (term (prop-get ,v ,k))))

  ;; ---- view-semantics.test.js ------------------------------------------------
  ;; "re-rendering patches the existing DOM"
  (define str-classes (term ((class Str (views ("main" (h 1 "span" () (field value))))))))
  (let* ([c0 (start str-classes '(comp Str (value "a")))]
         [span0 (label-at c0 (addr-of c0 (by-tag "span")))]
         [c1 (drain (with-root c0 '(comp Str (value "b"))))])
    (test-equal (label-at c1 (addr-of c1 (by-tag "span"))) span0)
    (test-equal (doms c1) (term (render (render-root ,(second c1) (comp Str (value "b")))))))
  ;; "components are wrapped in meta comments"
  (test-equal (filter (λ (d) (eq? (first d) 'comment))
                      (doms (start (term ((class C (views ("main" (h 1 "b" () "x")))))) '(comp C))))
              '((comment "§{\"t\":\"component\"}§") (comment "§/§")))

  ;; ---- event-metadata.test.js ----------------------------------------------
  ;; "wrapperless component chain preserves {field,seqItem,provided} paths and
  ;; named view ownership"
  (for ([source '((field child) (seq-item items selected) (provided child))])
    (define classes
      (term ((class Child
               (views ("main" (h 10 "i" ()))
                      ("compact" (h 11 "button" ((on click (send inc))) (h 12 "span" () "increment"))))
               (on (inc () (set (count) (+ (get draft count) 1)) (notify changed))))
             (class Panel
               (provides (child ((pb-field child))))
               (views ("main" (push-view "compact" (x-render ,source none))))
               (on (changed () (log "panel"))))
             (class Root
               (views ("main" (x-render (field panel) none)))
               (on (changed () (log "root")))))))
    (define child '(comp Child (count 0)))
    (define c (start classes `(comp Root (panel (comp Panel (selected 1) (child ,child) (items (arr null ,child)))))))
    (define c1 (click c (addr-of c (by-tag "span"))))
    (test-equal (if (equal? source '(seq-item items selected))
                    (get c1 'panel 'items 1 'count)
                    (get c1 'panel 'child 'count))
                1)
    (test-equal (logs c1) '("panel" "root"))
    (test-equal (failures c1) '()))

  ;; "top-level each routes every item after keyed reorder"
  (define each-classes
    (term ((class Item (views ("main" (h 1 "button" ()))))
           (class Root
             (loops (byId (key (get value id))))
             (views ("main" (each (field items) (h 2 "button" ((on click (send pick (source-key))))) byId)))
             (on (pick (k) (set (picked) (push (get draft picked) (get (at (get draft items) k) id)))))))))
  (let* ([c0 (start each-classes '(comp Root (picked (arr))
                                        (items (arr (comp Item (id "a")) (comp Item (id "b"))))))]
         [a (label-at c0 (first (addrs-where c0 (by-tag "button"))))]
         [b (label-at c0 (second (addrs-where c0 (by-tag "button"))))]
         [c1 (click (click c0 (addr-of-label c0 a)) (addr-of-label c0 b))]
         [_ (test-equal (get c1 'picked) '(arr "a" "b"))]
         [c2 (drain (with-root c1 '(comp Root (picked (arr))
                                         (items (arr (comp Item (id "b")) (comp Item (id "a")))))))]
         [_ (test-equal (map (λ (addr) (label-at c2 addr)) (addrs-where c2 (by-tag "button"))) (list b a))]
         [c3 (click (click c2 (addr-of-label c2 b)) (addr-of-label c2 a))])
    (test-equal (get c3 'picked) '(arr "b" "a")))

  ;; "nested multi-root loops retain paths across text, comments, empty scopes
  ;; and siblings"
  (define multi
    (term ((class Root
             (views ("main" (frag (each (field groups)
                                        (each (field items)
                                              (if (field visible)
                                                  (frag (h 1 "button" ((on click (send pick (source-key)))))
                                                        (frag "text between roots" (comment "ordinary comment"))
                                                        (h 2 "button" ((on click (send pick (source-key))))))
                                                  null)
                                              none)
                                        none)
                                  (h 3 "button" ((on click (send pick (source-key))))))))
             (on (pick (k) (set (picked) (push (get draft picked) k))))))))
  (let* ([c0 (start multi '(comp Root (picked (arr))
                                 (groups (arr (rec (items (arr (rec (visible #f)) (rec (visible #t))
                                                               (rec (visible #f)))))))))]
         [buttons (map (λ (a) (label-at c0 a)) (addrs-where c0 (by-tag "button")))]
         [c1 (for/fold ([c c0]) ([b buttons]) (click c (addr-of-label c b)))])
    (test-equal (get c1 'picked) '(arr 1 1 null))
    ;; An unmanaged element with a known data-eid, appended to the container.
    (define c2 (list-set c1 6 (append (cfg-dom c1) `((element 999 ,HTML-NS "button" ((data-eid 2)) ())))))
    (test-equal (get (drain (queue-events c2 (addr-of-label c2 999))) 'picked) '(arr 1 1 null)))

  ;; "renderIt promotes only its own scope and stops event lookup at its view"
  (define render-it-classes
    (term ((class Item
             (views ("main" (frag (h 1 "button" ((on click (send inc)))) (h 2 "i" ()))))
             (on (inc () (set (count) (+ (get draft count) 1)))))
           (class Root
             (views ("main" (each (field items)
                                  (h 3 "section" ((on click (send pick (source-key))))
                                     (render-it none)
                                     (h 4 "button" ((on click (send pick (source-key))))))
                                  none)))
             (on (pick (k) (set (picked) (push (get draft picked) k))))))))
  (let* ([c0 (start render-it-classes '(comp Root (picked (arr)) (items (arr (comp Item (count 0))))))]
         [c1 (click c0 (first (addrs-where c0 (by-tag "button"))))]
         [c2 (click c1 (addr-of c1 (by-tag "i")))])
    (test-equal (get c2 'items 0 'count) 1)
    (test-equal (get c2 'picked) '(arr))
    (define c3 (click c2 (second (addrs-where c2 (by-tag "button")))))
    (define c4 (click c3 (addr-of c3 (by-tag "section"))))
    (test-equal (get c4 'picked) '(arr 0 0)))

  ;; ---- source-key.test.js ------------------------------------------------------
  ;; "sourceKey is relative to the receiver for events, notifies, sends and replies"
  (define source-key-classes
    (term ((class Leaf
             (views ("main" (h 1 "button" ((on click (send click))))))
             (on (click () (log (mk-arr "leaf click" sourceKey)) (notify ping) (ask load))
                 (loadReplyOk (r) (log (mk-arr "leaf reply" sourceKey)))))
           (class Mid
             (views ("main" (h 2 "div" () (each (field rows) (h 3 "p" () (each (field cells) (render-it none) none)) none))))
             (on (ping () (log (mk-arr "mid notify" sourceKey)))))
           (class Top
             (views ("main" (h 4 "div" () (render-each (field mids) none))))
             (on (ping () (log (mk-arr "top notify" sourceKey)) (send-at ping () ((pb-item mids 1)))))))))
  (let* ([mid '(comp Mid (rows (arr (rec (cells (arr)))
                                    (rec (cells (arr (comp Leaf) (comp Leaf) (comp Leaf)))))))]
         [c0 (start source-key-classes `(comp Top (mids (arr (comp Mid (rows (arr))) ,mid)))
                    #:asks '((load (ok "loaded"))))]
         [c1 (click c0 (third (addrs-where c0 (by-tag "button"))))])
    (test-equal (failures c1) '())
    (test-equal (logs c1) '((arr "leaf click" null) (arr "mid notify" 2) (arr "leaf reply" null)
                            (arr "top notify" 1) (arr "mid notify" null))))

  ;; ---- task-paths.test.js ----------------------------------------------------
  (define (task-setup root-handlers [item-handlers '()] #:provided [use-provided #f]
                      #:asks [asks '()] #:root [root #f])
    (define names (map first root-handlers))
    (define classes
      (term ((class Item
               (views ("main" (h 1 "button" ((id "item") (on click (send inc))) "inc")))
               (on (inc () (set (count) (+ (get draft count) 1))) ,@item-handlers))
             (class Root
               (provides (selectedItem ((pb-seq-item items selected))))
               (views ("main" (h 2 "div" ()
                                 ,@(for/list ([n names] [i (in-naturals 10)])
                                     `(h ,i "button" ((id ,(symbol->string n)) (on click (send ,n)))
                                         ,(symbol->string n)))
                                 (x-render ,(if use-provided '(provided selectedItem) '(seq-item items selected))
                                           none))))
               (on ,@root-handlers)))))
    ;; Later handlers shadow the default inc, as in {inc, ...itemHandlers}.
    (define fixed (match classes
                    [`((class Item ,v (on ,hs ...)) ,r)
                     `((class Item ,v (on ,@(reverse (remove-duplicates (reverse hs) #:key first)))) ,r)]))
    (define item '(comp Item (count 0) (selected 0) (children (arr)) (reply null)))
    (start fixed (or root `(comp Root (selected 0) (committed 0) (items (arr ,item ,item)))) #:asks asks))
  (define (queue-ids c . ids) (apply queue-events c (for/list ([id ids]) (addr-of c (by-id id)))))
  (define (counts c) (match (get c 'items) [`(arr ,is ...) (for/list ([i is]) (term (prop-get ,i count)))]))

  ;; "generated paths capture producer commit before intervening tasks run"
  (let ([c (drain (queue-ids (task-setup '((queue () (send-at inc () ((pb-seq-item items selected)))
                                                  (set (selected) 1))
                                           (change () (set (selected) 0))))
                             "queue" "change"))])
    (test-equal (counts c) '(0 1))
    (test-equal (get c 'selected) 0)
    (test-equal (failures c) '()))

  ;; "DOM event paths retain event-time selection behind older queued work"
  (let ([c (drain (queue-ids (task-setup '((change () (set (selected) 1)))) "change" "item"))])
    (test-equal (counts c) '(1 0)))

  ;; "failed producers discard drafts and children but preserve older tasks"
  (let ([c (drain (queue-ids (task-setup '((fail () (set (selected) 1)
                                                 (send-at inc () ((pb-seq-item items selected)))
                                                 (fail "producer failed"))
                                           (keep () (set (committed) (+ (get draft committed) 1)))))
                             "fail" "keep"))])
    (test-equal (get c 'selected) 0)
    (test-equal (get c 'committed) 1)
    (test-equal (counts c) '(0 0))
    (test-equal (failures c) '((failed fail)))
    (test-equal (last (cfg-obs c)) 'rendered)
    (test-equal (pair? (addrs-where c (by-id "item"))) #t))

  ;; "child path preparation failure rolls back the producer and all its children"
  (let ([c (drain (queue-ids (task-setup '((fail () (set (selected) 1)
                                                 (send-at inc () ((pb-seq-item items selected)))
                                                 (send-at inc () ((pb-field missing) (pb-seq-item items selected))))
                                           (keep () (set (committed) (+ (get draft committed) 1)))))
                             "fail" "keep"))])
    (test-equal (get c 'selected) 0)
    (test-equal (get c 'committed) 1)
    (test-equal (counts c) '(0 0))
    (test-equal (failures c) '((failed fail))))

  ;; "async {success,error} reply reuses captured caller path"
  (for ([result '(ok error)])
    (define reply-handler '((r) (set (reply) r) (send-at inc () ())))
    (define c0 (task-setup '((queue () (send-at request () ((pb-seq-item items selected))) (set (selected) 1))
                             (change () (set (selected) 0)))
                           `((request () (ask load))
                             (loadReplyOk ,@reply-handler)
                             (loadReplyError ,@reply-handler))
                           #:asks `((load (async (,result "result"))))))
    (define c1 (drain (queue-ids (drain (queue-ids c0 "queue")) "change")))
    (test-equal (length (cfg-pending c1)) 1)
    (define c2 (resolve-ask c1))
    (match-define `((task ,_ ,_ ,_ ,source ,target ,_)) (cfg-queue c2))
    (test-equal source '((frame none ("items") 1 #t)))
    (test-equal target `(at ,source ()))
    (define c3 (drain c2))
    (test-equal (get c3 'items 1 'reply) "result")
    (test-equal (get c3 'items 0 'reply) 'null)
    (test-equal (counts c3) '(0 1))
    (test-equal (failures c3) '()))

  ;; "a throwing sync ReplyOk fails the ask instead of running ReplyError"
  (let ([c (drain (queue-ids (task-setup '((queue () (send-at request () ((pb-seq-item items selected)))))
                                         '((request () (ask load))
                                           (loadReplyOk (r) (set (reply) "ok") (send-at inc () ()) (fail "reply failed"))
                                           (loadReplyError (r) (set (reply) "error")))
                                         #:asks '((load (ok "result"))))
                             "queue"))])
    (test-equal (get c 'items 0 'reply) 'null)
    (test-equal (counts c) '(0 0))
    (test-equal (failures c) '((failed load))))

  ;; "dynamic selectors below provided frames capture commit and retain bubbling"
  (let* ([item (λ (sel kids) `(comp Item (count 0) (selected ,sel) (children ,kids) (reply null)))]
         [kids `(arr ,(item 0 '(arr)) ,(item 0 '(arr)))]
         [c0 (task-setup '((change () (set (items (at 0) selected) 0))
                           (changed () (log "root")))
                         '((inc () (send-at bump () ((pb-seq-item children selected))) (set (selected) 1))
                           (bump () (set (count) (+ (get draft count) 1)) (notify changed))
                           (changed () (log "item")))
                         #:provided #t
                         #:root `(comp Root (selected 0) (committed 0)
                                       (items (arr ,(item 0 kids) ,(item 0 '(arr))))))]
         [c (drain (queue-ids c0 "item" "change"))])
    (test-equal (match (get c 'items 0 'children)
                  [`(arr ,is ...) (for/list ([i is]) (term (prop-get ,i count)))])
                '(0 1))
    (test-equal (logs c) '("item" "root"))
    (test-equal (failures c) '()))

  ;; ---- message-context.test.js -------------------------------------------------
  ;; "forwardAt from an event handler forwards the sent message and keeps the
  ;; DOM event as cause" (the cause is not modeled)
  (let* ([classes '((class Child (views ("main" (h 1 "span" ()))) (on (act (n) (set (got) n))))
                    (class Parent
                      (views ("main" (h 2 "div" () (h 3 "button" ((on click (send act 7))))
                                        (x-render (field child) none))))
                      (on (act () (forward-at ((pb-field child)))))))]
         [c0 (start classes '(comp Parent (child (comp Child (got null)))))]
         [c (click c0 (addr-of c0 (by-tag "button")))])
    (test-equal (failures c) '())
    (test-equal (get c 'child 'got) 7))

  ;; ---- routing soundness -------------------------------------------------------
  ;; For random component trees rendered through every kind of source (fields,
  ;; seqItem, provided at any depth, loops, renderEach, renderIt, named views
  ;; and the view stack), every element with handlers routes to the instance
  ;; that rendered it: each button shows its own instance's id.
  (define sound-classes
    (term ((class Leaf (views ("main" (h 1 "button" ((on click (send hit))) (field id)))))
           (class Box
             (views ("main" (h 2 "div" ()
                               (h 3 "button" ((on click (send hit))) (field id))
                               (each (field kids) (render-it none) none)
                               (if (field child) (x-render (field child) none) null)))))
           (class Sel
             (provides (cur ((pb-seq-item kids sel))))
             (loops (keyed (key (get value id))))
             (views ("main" (frag (h 4 "button" ((on click (send hit))) (field id))
                                  (if (provided cur) (x-render (provided cur) none) null)
                                  (render-each (field kids) keyed)))))
           (class Pick
             (views ("main" (frag (h 5 "button" ((on click (send hit))) (field id))
                                  (if (seq-item kids sel) (x-render (seq-item kids sel) "alt") null)))
                    ("alt" (push-view "alt" (h 6 "section" () (h 7 "button" ((on click (send hit))) (field id))
                                               (each (field kids) (render-it none) none)))))))))
  (define next-id 0)
  (define (random-instance depth)
    (set! next-id (add1 next-id))
    (define id (format "c~a" next-id))
    (define (kids) `(arr ,@(for/list ([_ (random (if (zero? depth) 1 3))]) (random-instance (sub1 depth)))))
    (case (if (zero? depth) 0 (random 4))
      [(0) `(comp Leaf (id ,id))]
      [(1) `(comp Box (id ,id) (kids ,(kids))
                  (child ,(if (zero? (random 2)) 'null (random-instance (sub1 depth)))))]
      [(2) (let ([ks (kids)]) `(comp Sel (id ,id) (kids ,ks) (sel ,(random (max 1 (sub1 (length ks)))))))]
      [else (let ([ks (kids)]) `(comp Pick (id ,id) (kids ,ks) (sel ,(random (max 1 (sub1 (length ks)))))))]))
  (define sound-registry (term (register-classes ,sound-classes)))
  (for ([_ 60])
    (define root (random-instance 3))
    (define dom (term (render (render-root ,sound-registry ,root))))
    (for ([a (addresses dom (λ (d) (assq 'data-eid (fourth d))))])
      (match-define `(element ,_ ,_ ,_ ((text ,shown))) (term (node-at ,dom ,a)))
      (match (term (event-info ,sound-registry ,root ,dom click ,a))
        [`((on click (send hit)) (,path ,update-path))
         (test-equal (term (prop-get (get-in ,update-path ,root) id)) shown)]
        [other (test-equal other 'routed)])))
  (test-results))
