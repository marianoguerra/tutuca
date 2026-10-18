#lang racket
;; Paths, split by what they are for.
;;
;;   upath   an update path: the property keys from the root state to a
;;           component. getIn and setIn read and write through it; nothing
;;           else does.
;;   dpath   a dispatch path: the frames of rendered ancestry, one per
;;           metadata comment and per render depth. Notify bubbling and
;;           sourceKey follow it; resolve turns it into an update path.
;;   sel     a selector: PathBuilder calls (field, item, seqItem) that read
;;           the state when they freeze, at commit.
;;   route   a dispatch path with its update path.
;;
;; A frame (frame base keys item cf) reads keys, then the item key if any, from
;; base: the previous frame, or the value a provider captured at depth d,
;; reached by its suffix keys. cf says that a component boundary follows the
;; frame, which makes it a component frame.
(require redex/reduction-semantics "data.rkt" "core.rkt")
(provide Paths access-keys get-in set-in resolve resolve-from to-component-path to-parent-path
         to-update-path frame-item-key key-at source-key-in frame-meta meta-frame promote item-frame
         item-of freeze-op freeze-sel route-for)

(define-extended-language Paths Core
  (dframe ::= (frame base (skey ...) item? boolean))
  (dpath ::= (dframe ...))
  (upath ::= (skey ...))
  (route ::= (dpath upath))
  ;; PathBuilder calls: b.field(f), b.item(f, k), b.seqItem(f, kf)
  (pb-op ::= (pb-field fname) (pb-item fname skey) (pb-seq-item fname fname))
  (sel ::= (pb-op ...)))

;; The keys a frame reads from its base.
(define-metafunction Paths
  access-keys : dframe -> upath
  [(access-keys (frame base (skey ...) none boolean)) (skey ...)]
  [(access-keys (frame base (skey ...) skey_i boolean)) (skey ... skey_i)])

;; Path.getIn on update paths: one property read per key.
(define-metafunction Paths
  get-in : upath value -> value
  [(get-in () value) value]
  [(get-in (skey_0 skey ...) value) (get-in (skey ...) (prop-get value skey_0))])

;; Path.setIn, as a new root.
(define-metafunction Paths
  set-in : upath value value -> value
  [(set-in () value_root value) value]
  [(set-in (skey_0 skey ...) value_root value)
   (prop-set value_root skey_0 (set-in (skey ...) (prop-get value_root skey_0) value))])

;; From frames to keys, left to right. Frame i starts where frame i-1 ended,
;; or, for a provider captured at depth d, at the end of the first d frames
;; followed by the provider's suffix.
(define-metafunction Paths
  resolve : dpath -> upath
  [(resolve dpath) ,(last (term (resolve-from dpath (()))))])

;; The keys of every prefix of the path, shortest first.
(define-metafunction Paths
  resolve-from : dpath (upath ...) -> (upath ...)
  [(resolve-from () (upath ...)) (upath ...)]
  [(resolve-from ((frame none any_k item? boolean) dframe ...) (upath ...))
   (resolve-from (dframe ...) (upath ... (skey_p ... skey ...)))
   (where (skey_p ...) ,(last (term (upath ...))))
   (where (skey ...) (access-keys (frame none any_k item? boolean)))]
  [(resolve-from ((frame (prov fname natural (skey_s ...)) any_k item? boolean) dframe ...) (upath ...))
   (resolve-from (dframe ...) (upath ... (skey_p ... skey_s ... skey ...)))
   (where (skey_p ...) ,(list-ref (term (upath ...)) (term natural)))
   (where (skey ...) (access-keys (frame none any_k item? boolean)))])

;; Drop trailing frames that are not component frames: an event inside a loop
;; item belongs to the component whose view has the loop.
(define-metafunction Paths
  to-component-path : dpath -> dpath
  [(to-component-path (dframe ... (frame base any_k item? #t))) (dframe ... (frame base any_k item? #t))]
  [(to-component-path (dframe ... dframe_last)) (to-component-path (dframe ...))]
  [(to-component-path ()) ()])

(define-metafunction Paths
  to-parent-path : dpath -> dpath
  [(to-parent-path (dframe ... dframe_last)) (dframe ...)])

(define-metafunction Paths
  to-update-path : dpath -> upath
  [(to-update-path dpath) (resolve (to-component-path dpath))])

(define-metafunction Paths
  route-for : dpath -> route
  [(route-for dpath) (dpath (to-update-path dpath))])

(define-metafunction Paths
  frame-item-key : dframe -> any
  [(frame-item-key (frame base any_k none boolean)) null]
  [(frame-item-key (frame base any_k skey boolean)) skey])

;; Path.sourceKeyIn: the item key of the frame that leads out of the
;; receiver's view, or null when the receiver itself or an ancestor sent it.
(define-metafunction Paths
  source-key-in : dpath dpath -> any
  [(source-key-in (dframe ...) (dframe_r ...)) null
   (side-condition (>= (length (term (dframe_r ...))) (length (term (dframe ...)))))]
  [(source-key-in dpath (dframe_r ...)) (key-at dpath ,(length (term (dframe_r ...))))])

(define-metafunction Paths
  key-at : dpath natural -> any
  [(key-at dpath natural) (key-at dpath ,(add1 (term natural)))
   (side-condition (< (term natural) (sub1 (length (term dpath)))))
   (where (frame base any_k item? #f) ,(list-ref (term dpath) (term natural)))]
  [(key-at dpath natural) (frame-item-key ,(list-ref (term dpath) (term natural)))])

;; Metadata drops cf: the component boundary that follows says it.
(define-metafunction Paths
  frame-meta : dframe -> meta
  [(frame-meta (frame base any_k item? boolean)) (frame base any_k item?)])

(define-metafunction Paths
  meta-frame : meta -> dframe
  [(meta-frame (frame base any_k item?)) (frame base any_k item? #f)])

;; A component boundary makes the frame before it a component frame.
(define-metafunction Paths
  promote : dpath -> dpath
  [(promote ()) ()]
  [(promote (dframe ... (frame base any_k item? boolean))) (dframe ... (frame base any_k item? #t))])

;; A loop item over a source frame: the same base, the source's keys, the item.
(define-metafunction Paths
  item-frame : dframe skey -> dframe
  [(item-frame (frame base any_k item? boolean) skey)
   (frame base (access-keys (frame base any_k item? boolean)) skey #f)])

;; The item a seqItem selects: its key, or none when the key field is null
;; (item ?? null in the runtime), so the frame points at the whole sequence.
(define-metafunction Paths
  item-of : value -> item?
  [(item-of null) none]
  [(item-of skey) skey])

;; Freezing one builder call against the value it starts from.
(define-metafunction Paths
  freeze-op : pb-op value -> dframe
  [(freeze-op (pb-field fname) value) (frame none (,(symbol->string (term fname))) none #t)]
  [(freeze-op (pb-item fname skey) value) (frame none (,(symbol->string (term fname))) skey #t)]
  [(freeze-op (pb-seq-item fname fname_k) value)
   (frame none (,(symbol->string (term fname))) (item-of (prop-get value fname_k)) #t)])

;; A selector freezes against the value it starts from, one call at a time.
(define-metafunction Paths
  freeze-sel : sel value -> dpath
  [(freeze-sel () value) ()]
  [(freeze-sel (pb-op_0 pb-op ...) value) (dframe_0 dframe ...)
   (where dframe_0 (freeze-op pb-op_0 value))
   (where (dframe ...) (freeze-sel (pb-op ...) (get-in (access-keys dframe_0) value)))])

(module+ test
  (require rackunit)
  ;; seqItem with an unset key: no item, the frame points at the whole sequence.
  (test-equal (term (freeze-op (pb-seq-item items sel) (rec (sel null))))
              (term (frame none ("items") none #t)))
  (define root
    (term (comp Root (selected 1)
                (items (arr (comp Item (count 0) (kids (arr)))
                            (comp Item (count 5) (kids (arr (comp Item (count 7)))))))
                (child (comp Item (count 2))))))

  (test-equal (term (get-in () ,root)) root)
  (test-equal (term (get-in ("child" "count") ,root)) 2)
  (test-equal (term (get-in ("items" 1 "count") ,root)) 5)
  (test-equal (term (get-in ("items" 1 "count") (set-in ("items" 1 "count") ,root 6))) 6)
  (test-equal (term (set-in () ,root 1)) 1)
  ;; Reading below null throws.
  (check-exn exn:fail? (λ () (term (get-in ("missing" "x" "y") ,root))))

  ;; Selectors freeze against the values they read.
  (test-equal (term (freeze-sel ((pb-seq-item items selected) (pb-field count)) ,root))
              (term ((frame none ("items") 1 #t) (frame none ("count") none #t))))
  (test-equal (term (freeze-sel ((pb-item items 1) (pb-seq-item kids count)) ,root))
              (term ((frame none ("items") 1 #t) (frame none ("kids") 5 #t))))
  ;; A selector below a missing field fails to freeze: null[k] throws.
  (check-exn exn:fail? (λ () (term (freeze-sel ((pb-field missing) (pb-seq-item items selected)) ,root))))

  ;; Frames resolve to keys; a provider jump restarts from the frame that
  ;; captured it, followed by its suffix.
  (define jump (term (frame (prov sel 0 ("items" 1)) () none #t)))
  (test-equal (term (resolve ((frame none ("child") none #t) ,jump (frame none ("kids") 0 #t))))
              (term ("items" 1 "kids" 0)))
  (test-equal (term (resolve ((frame none ("child") none #t) (frame (prov sel 0 ("items" 1)) () 0 #f))))
              (term ("items" 1 0)))
  (test-equal (term (resolve ((frame none ("panel") none #t) (frame (prov c 1 ("child")) () none #t))))
              (term ("panel" "child")))
  (test-equal (term (get-in (resolve (,jump (frame none ("kids") 0 #t) (frame none ("count") none #t))) ,root)) 7)

  ;; Loop items that are not component frames belong to the enclosing component.
  (test-equal (term (to-component-path ((frame none ("a") none #t) (frame none ("xs") 0 #f) (frame none () 1 #f))))
              (term ((frame none ("a") none #t))))
  (test-equal (term (to-update-path ((frame none ("xs") 0 #t) (frame none ("ys") 1 #f))))
              (term ("xs" 0)))
  (test-equal (term (item-frame (frame none ("s") 2 #t) 0)) (term (frame none ("s" 2) 0 #f)))
  (test-equal (term (item-frame ,jump 3)) (term (frame (prov sel 0 ("items" 1)) () 3 #f)))

  ;; sourceKeyIn: the item key leading out of the receiver's view.
  (define p (term ((frame none ("mids") 1 #t) (frame none ("rows") 1 #f) (frame none ("cells") 2 #t))))
  (test-equal (term (source-key-in ,p ())) 1)
  (test-equal (term (source-key-in ,p ((frame none ("mids") 1 #t)))) 2)
  (test-equal (term (source-key-in ,p ,p)) 'null)
  (test-equal (term (source-key-in ((frame none ("a") none #t)) ())) 'null)

  ;; Metadata round trip; cf comes back from promotion.
  (for ([f (term ((frame none ("a") none #t) (frame none ("xs") 0 #f) (frame ,(second jump) () 4 #f)))])
    (define parsed (term (meta-frame ,(string->meta (meta->string (term (frame-meta ,f)))))))
    (test-equal (if (fifth f) (term (promote (,parsed))) (list parsed)) (list f)))

  ;; Freezing a selector at the end of a resolved base equals resolving the base
  ;; with the frozen frames appended: selector frames carry no provider jumps.
  (define (random-sel value depth)
    (match value
      [_ #:when (zero? depth) '()]
      [(list 'comp _ fs ...)
       (define f (first (list-ref fs (random (length fs)))))
       (define v (term (prop-get ,value ,f)))
       (match v
         [(list 'arr vs ..1)
          (define i (random (length vs)))
          (cons `(pb-item ,f ,i) (random-sel (list-ref vs i) (sub1 depth)))]
         [_ (cons `(pb-field ,f) (random-sel v (sub1 depth)))])]
      [_ '()]))
  (define bases (list '() (term ((frame none ("items") 1 #t))) (term ((frame none ("child") none #t) ,jump))))
  (for* ([_ 50] [base bases])
    (define start (term (get-in (resolve ,base) ,root)))
    (define sel (random-sel start 3))
    (define frozen (term (freeze-sel ,sel ,start)))
    (test-equal (term (resolve (,@base ,@frozen)))
                (append (term (resolve ,base)) (append* (for/list ([f frozen]) (term (access-keys ,f))))))
    (test-equal (term (get-in (resolve (,@base ,@frozen)) ,root))
                (term (get-in (resolve ,frozen) ,start))))
  (test-results))
