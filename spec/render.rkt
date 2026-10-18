#lang racket
;; Typesets the spec layers into semantics.pdf, laid out like a paper on
;; A4 pages:
;;   racket spec/render.rkt
(require redex/pict pict racket/draw racket/runtime-path
         "data.rkt" "core.rkt" "normalize.rkt" "dom.rkt" "keys.rkt" "morph.rkt"
         "paths.rkt" "host.rkt" "view.rkt" "routing.rkt" "tasks.rkt")

(define-runtime-path out "semantics.pdf")

;; ---- page geometry (points) -------------------------------------------------
(define page-width 595)                 ; A4
(define page-height 842)
(define margin-x 64)
(define margin-top 64)
(define margin-bottom 72)
(define text-width (- page-width (* 2 margin-x)))
(define text-height (- page-height margin-top margin-bottom))
(define block-gap 18)

;; ---- typography -------------------------------------------------------------
(define serif 'roman)
(define (doc-title-text str) (text str (cons 'bold serif) 24))
(define (subtitle-text str) (text str (cons 'italic serif) 13))
(define (chapter-label-text str) (text str serif 12))
(define (title-text str) (text str (cons 'bold serif) 18))
(define (section-text str) (text str (cons 'bold serif) 12))
(define (caption-text str) (text str serif 10))
(define (sublabel-text str) (text str (cons 'italic serif) 10))

;; words laid out in lines no wider than width
(define (wrap str style size [width text-width])
  (define (line s) (text s style size))
  (define lines
    (for/fold ([lines '()] #:result (reverse lines))
              ([word (in-list (string-split str))])
      (match lines
        ['() (list word)]
        [(cons current done)
         (define joined (string-append current " " word))
         (if (<= (pict-width (line joined)) width)
             (cons joined done)
             (list* word lines))])))
  (apply vl-append 3 (map line lines)))

(define (para str) (wrap str serif 10))

;; ---- Racket escapes as notation -------------------------------------------
;; `,(f (term x))` and side-conditions print as math-style calls, e.g.
;; String(atom), instead of highlighted Racket code.
(define escape-names
  (hash 'js-string "String"
        'truthy? "truthy?"
        'key->symbol "key"
        'meta->string "metaText"
        'string->meta "parseMeta"
        'meta-like? "metaLike?"
        'list-ref "nth"
        'take "take"
        'drop "drop"
        'first "first"
        'last "last"
        'add1 "succ"
        'sub1 "pred"
        'length "length"
        'reverse "reverse"
        'string-downcase "lower"))

;; move an lw, and every lw nested in it, by delta columns
(define (shift-lw l delta)
  (struct-copy lw l
               [column (+ (lw-column l) delta)]
               [e (if (list? (lw-e l))
                      (for/list ([x (in-list (lw-e l))])
                        (if (lw? x) (shift-lw x delta) x))
                      (lw-e l))]))

;; an argument written (term x): redex lays it out as ("" spring x)
(define (term-arg? a)
  (match (lw-e a)
    [(list (lw "" _ _ _ _ _ _) 'spring _) #t]
    [_ #f]))

(define (unquote-rewriter l)
  (match (lw-e l)
    [(list open (lw (? symbol? f) _ _ _ _ _ _) args ... close)
     #:when (and (hash-has-key? escape-names f) (andmap term-arg? args))
     ;; drop the implicit (term ...) wrapper around each argument
     (define inners (for/list ([a (in-list args)]) (last (lw-e a))))
     (define line (lw-line open))
     ;; lay the arguments out left to right, separated by ", "
     (define-values (placed col)
       (for/fold ([acc '()] [col (+ (lw-column open) 1)])
                 ([inner (in-list inners)] [i (in-naturals)])
         (define arg (shift-lw inner (- col (lw-column inner))))
         (define after (+ col (lw-column-span inner)))
         (if (< i (sub1 (length inners)))
             (values (list* (build-lw ", " line 0 after 2) arg acc) (+ after 2))
             (values (cons arg acc) after))))
     ;; stretch ")" to where the original escape ended, so the text after
     ;; it isn't pushed right by the columns the longer Racket name used
     (define end (+ (lw-column close) (lw-column-span close)))
     (struct-copy
      lw l
      [unq? #f]
      [e (append (list (struct-copy lw open
                                    [e (string-append (hash-ref escape-names f) "(")]
                                    [unq? #f]))
                 (reverse placed)
                 (list (struct-copy lw close
                                    [column col]
                                    [column-span (max 1 (- end col))]
                                    [unq? #f])))])]
    [_ l]))

;; ---- building blocks ------------------------------------------------------
;; Render with the default side-by-side layout. If that is slightly wider
;; than the text column, scale it down a little; if it would need more
;; than that, stack each right-hand side under its left-hand side, with
;; one side condition per line.
(define min-scale 0.8)

(define (shrink-to-fit p)
  (if (<= (pict-width p) text-width)
      p
      (scale p (/ text-width (pict-width p)))))

(define (fit thunk)
  (define wide (thunk))
  (if (>= (/ text-width (pict-width wide)) min-scale)
      (shrink-to-fit wide)
      (shrink-to-fit (parameterize ([metafunction-pict-style 'up-down/vertical-side-conditions])
                       (thunk)))))

(define-syntax-rule (mf name) (fit (λ () (render-metafunction name))))
(define-syntax-rule (lang l nts ...) (fit (λ () (render-language l nts ...))))

;; a titled part inside a figure
(define (part label p)
  (vl-append 5 (sublabel-text label) p))

(define figure-count 0)

;; a numbered figure: rules above and below, caption underneath. It is laid
;; out given the height it may take; a taller body is scaled down to fit.
(define (figure caption . parts)
  (set! figure-count (add1 figure-count))
  (define label (format "Figure ~a. ~a" figure-count caption))
  (define body (apply vl-append 12 parts))
  (define rule (linewidth 0.5 (hline text-width 1)))
  (define (framed b)
    (vc-append
     6
     rule
     (inset (lt-superimpose (blank text-width 0) b) 0 4)
     rule
     (wrap label serif 10)))
  (λ (max-height)
    (define over (- (pict-height (framed body)) max-height))
    (framed (if (positive? over)
                (scale body (/ (- (pict-height body) over) (pict-height body)))
                body))))


;; ---- document structure -----------------------------------------------------
;; Chapters go from the bottom of the framework to the top: each one only uses
;; what the chapters before it define. Numbers are assigned when laying out.
(struct chapter (title summary sections))
(struct section (title summary figures))

(define (chap title summary . sections) (chapter title summary sections))
(define (sect title summary . figures) (section title summary figures))

;; ---- content --------------------------------------------------------------
(define (note . lines) (apply vl-append 4 (map caption-text lines)))

(define doc-title "A Formal Model of Tutuca")
(define doc-subtitle "Growing a UI framework from values to the task queue")

(define abstract
  (list
   (string-append
    "This document specifies the meaning of the tutuca core and vdom.js as a PLT Redex model. "
    "It is built bottom up, the way the framework grows: plain values first, then the "
    "virtual nodes a view builds and the DOM they render to, then reconciliation of an "
    "existing DOM against new vnodes, then the paths that name places in the state, then "
    "components and their views, and finally the events and the task queue that close "
    "the loop from a click back to a re-render.")
   (string-append
    "Conventions. A metafunction undefined on its input stands for a thrown JS exception. "
    "The optimizations in src/optimize.js and the fast paths in vdom.js are erased; they "
    "must preserve the meaning given here. Shaded fragments inside a rule are Racket code. "
    "The rules are executable: raco test spec/ checks them against scenarios ported from "
    "the JS test suite and against random properties.")))

(define (content)
  (list
   (chap
    "Values"
    (string-append
     "The values views read and message handlers write. State is a value, a component "
     "instance is a value, and the effect of a handler is a new value, so everything "
     "later is built on this chapter.")
    (sect
     "Runtime values"
     (string-append
      "Atoms, null (which also stands for undefined), arrays, records and components. A "
      "component instance is a record tagged with its class name. These are the only "
      "objects: JS functions appear later as host terms (Chapter 5).")
     (figure "Runtime values: atoms, null (also undefined), arrays, records and components."
             (lang Data)))
    (sect
     "Property access"
     (string-append
      "Reading and writing one property, as immer drafts see it. A missing property reads "
      "as null; reading a property of null has no rule, which is the TypeError. Writes "
      "never mutate: they build a new array, record or component. entries-of gives the "
      "pairs a loop iterates over.")
     (figure "Property access, as immer drafts see it: writes build new values."
             (part "prop-get: v[k]; null[k] has no rule (TypeError)" (mf prop-get))
             (part "field-get" (mf field-get))
             (part "prop-set: v[k] = x" (mf prop-set))
             (part "field-set" (mf field-set))
             (part "entries-of: array entries or Object.entries" (mf entries-of)))))

   (chap
    "Virtual DOM"
    (string-append
     "What evaluating a view produces and what that becomes in the browser. This chapter "
     "fixes the shape of normalized vnodes, how evaluated results flatten into them, and "
     "how they render into an empty container.")
    (sect
     "Normalized vnodes"
     (string-append
      "Elements, wrapperless groups with an optional key, and leaves: text, comments and "
      "metadata comments, which mark where components, fields and loop items begin and "
      "end. An element carries its template id tid, which is its Shape: only elements of "
      "the same template are the same kind. Props are sorted by name, since attribute "
      "order is not observable, and svg and math set their own namespace.")
     (figure "Normalized vnodes. tid is the element's template (its Shape); props are sorted by name."
             (lang Core #:nts '(tag ns ns? tid key? prop-name prop-value prop skey base item? meta leaf node)))
     (figure "Element construction."
             (part "shape-of: svg and math set their own namespace" (mf shape-of))
             (part "make-el: new VNode(shape, values, childs, key)" (mf make-el))))
    (sect
     "Normalization"
     (string-append
      "addChild: the results an expression evaluates to become a flat node sequence. "
      "Arrays and fragments splice, null drops out, a node is kept, and any other value "
      "becomes text through String(). key-of turns a key value into a string key, or "
      "none for null.")
     (figure "addChild: from evaluated results to a flat node sequence."
             (lang Norm #:nts '(result))
             (part "normalize: iterables splice, null drops, other values become text" (mf normalize))
             (part "key-of: key != null ? String(key) : undefined" (mf key-of))))
    (sect
     "DOM output"
     (string-append
      "toDom into a fresh container. Groups contribute their children with no wrapper, "
      "metadata becomes JSON comment text, and the namespace flows from parent to child, "
      "with foreignObject switching SVG back to HTML. A fresh render is the reference "
      "every reconciliation must agree with.")
     (figure "DOM output: groups have no wrapper; metadata becomes comment text."
             (lang DOM #:nts '(dom))
             (part "child-ns: foreignObject resets SVG to HTML" (mf child-ns))
             (part "to-dom" (mf to-dom))
             (part "render-into" (mf render-into))
             (part "render: the container's children" (mf render)))))

   (chap
    "Reconciliation"
    (string-append
     "Updating an existing DOM to match new vnodes while keeping as many browser nodes "
     "as possible. DOM nodes carry labels that stand for their identity, so the model "
     "says which nodes survive a morph, not only what the DOM looks like after it.")
    (sect
     "Keyed sibling matching"
     (string-append
      "The first half of morphChildren: which old sibling each new sibling reuses. Keyed "
      "nodes are looked up by key and unkeyed nodes are taken in order, independently of "
      "each other. Matching stays within one element's or fragment's children and "
      "identifies whole virtual nodes, empty groups included. Duplicate keys on either "
      "side are an error.")
     (figure "Matching is local to each element or explicit fragment's children."
             (lang Keyed #:nts '(index match-result matches))
             (part "node-key" (mf node-key))
             (part "find-key" (mf find-key))
             (part "unkeyed-indices" (mf unkeyed-indices)))
     (figure "Matched indices identify whole virtual nodes, including empty groups."
             (part "match-next: keyed lookup and unkeyed order are independent" (mf match-next))
             (part "match-siblings: duplicate keys in either sequence are rejected" (mf match-siblings))))
    (sect
     "Labeled DOM and mounting"
     (string-append
      "The DOM with identities. mount is toDom minting a fresh label for every node it "
      "creates. A virtual node may own zero, one or several DOM nodes, so dom-width and "
      "split-groups cut a DOM sequence into the range each virtual node owns.")
     (figure "Labeled DOM: a label is a browser node's identity."
             (lang Morph #:nts '(lbl ldom comment-node lgroups out))
             (part "comment-text" (mf comment-text))
             (part "el-ns" (mf el-ns))
             (part "mount: toDom, minting labels" (mf mount))
             (part "mount-all" (mf mount-all)))
     (figure "Each virtual node owns a range of DOM nodes."
             (part "dom-width" (mf dom-width))
             (part "split-groups" (mf split-groups))))
    (sect
     "Morphing"
     (string-append
      "morphNode keeps a node when the leaf kind matches or, for elements, when the "
      "template and key match; it then patches every prop and morphs the children. "
      "Otherwise it mounts a replacement. morphChildren reuses each matched source's DOM "
      "range and mounts the rest. Checked: forgetting the labels after a morph gives a "
      "fresh render of the new tree, and morphing a tree into itself keeps every label.")
     (figure "morphNode: same leaf kind, or same template and key, keeps the node."
             (part "morph-node" (mf morph-node)))
     (figure "morphChildren: matched targets reuse their source's DOM; the rest mount."
             (part "morph-children" (mf morph-children))
             (part "morph-seq" (mf morph-seq))
             (part "morph-one" (mf morph-one))
             (part "erase: forget identities" (mf erase))
             (note "Checked: erase(morph(mount(old), old, new)) = render(new); morph(x, x) keeps every label."))))

   (chap
    "Paths"
    (string-append
     "How places are named. There are four kinds of path, one per job: update paths "
     "address state, dispatch paths record rendered ancestry, selectors describe targets "
     "read at commit time, and routes pair a dispatch path with its update path. Keeping "
     "them apart is what lets providers, loops and deferred tasks reach the right "
     "component.")
    (sect
     "Kinds of path"
     (string-append
      "The syntax of frames, dispatch paths, update paths, selectors and routes. A frame "
      "reads its keys, then its item key, from its base: the previous frame's value, or "
      "the value a provider captured at some render depth. get-in and set-in are getIn "
      "and setIn, the only operations that touch state through an update path.")
     (figure "Update paths, dispatch frames, selectors and routes are different things."
             (lang Paths #:nts '(dframe dpath upath route pb-op sel))
             (part "access-keys: what a frame reads from its base" (mf access-keys))
             (part "get-in: getIn on update paths" (mf get-in))
             (part "set-in: setIn on update paths" (mf set-in))))
    (sect
     "Resolving"
     (string-append
      "From a dispatch path to the state keys it stands for, frame by frame from left to "
      "right. A provider frame restarts at the end of the frames up to its capture depth, "
      "followed by its suffix. to-component-path drops trailing frames that are not "
      "component frames, so an event inside a loop item belongs to the component whose "
      "view has the loop; route-for pairs a dispatch path with its update path.")
     (figure "Resolving: frames to keys; a provider jump restarts at its capture depth."
             (part "resolve" (mf resolve))
             (part "resolve-from" (mf resolve-from))
             (part "to-component-path" (mf to-component-path))
             (part "to-update-path" (mf to-update-path))
             (part "route-for" (mf route-for))))
    (sect
     "sourceKey and metadata"
     (string-append
      "sourceKey is the item key of the frame that leads out of the receiver's view, or "
      "null when the receiver itself or an ancestor sent the message. frame-meta and "
      "meta-frame convert a frame to a metadata comment and back. promote marks the frame "
      "before a component boundary as a component frame, and item-frame is the frame a "
      "loop item adds over its source.")
     (figure "sourceKey and metadata."
             (part "source-key-in" (mf source-key-in))
             (part "key-at" (mf key-at))
             (part "frame-item-key" (mf frame-item-key))
             (part "frame-meta" (mf frame-meta))
             (part "meta-frame" (mf meta-frame))
             (part "promote: a component boundary follows the frame" (mf promote))
             (part "item-frame: a loop item over a source frame" (mf item-frame))))
    (sect
     "Selectors"
     (string-append
      "A selector is a sequence of path builder calls (field, item, seqItem). It freezes "
      "at commit, one call at a time, against the value it starts from, and the frames it "
      "freezes to extend its base. Checked: freezing below a base equals resolving the "
      "base with the frozen keys appended.")
     (figure "Selectors freeze against the values they read."
             (part "freeze-op" (mf freeze-op))
             (part "freeze-sel" (mf freeze-sel))
             (note "Checked: resolve(base ++ freeze-sel(sel, get-in(resolve(base), root)))"
                   "= resolve(base) ++ the frozen keys."))))

   (chap
    "Components and views"
    (string-append
     "The layer users write against. A component supplies code (loop hooks, binds, "
     "providers, handlers) and views (templates of expressions). Registration indexes "
     "event handlers by template id; rendering evaluates a view in a render context and "
     "produces the vnodes of Chapter 2, with the metadata that Chapter 6 reads back.")
    (sect
     "Host code"
     (string-append
      "The JavaScript a component supplies, as a small pure language: host expressions "
      "for loop hooks and scope binds, path builder terms for provides, ask handlers, and "
      "a command language for message handlers (set, replace, notify, ask, send-at, "
      "forward-at, stop-next, log, fail, when). eval-hx evaluates host expressions.")
     (figure "User functions as terms: hooks, binds, providers, asks and handlers."
             (lang Host #:nts '(x env hx class-def section handler loop loop-opt cmd lv ask-def ask-result)))
     (figure "Host expressions."
             (part "eval-hx" (mf eval-hx))))
    (sect
     "View syntax"
     (string-append
      "Every form a template can use: field, seqItem, provided, lookupBind, $if, h, "
      "render, each, renderEach, renderIt, scope and pushView, plus constants and "
      "multi-root fragments. Also attributes, event actions, render contexts and the "
      "registry of classes.")
     (figure "View expressions, attributes, actions and render contexts."
             (lang View #:nts '(result e src loop-name? attr on-attr action arg ctx binds dyn
                                table registration registry))))
    (sect
     "Registration"
     (string-append
      "component() and the Collect walker. Each class gets one table from template id to "
      "the event handlers of that element, built by walking every view: an element's "
      "entry, then its attribute expressions, then its children. A class needs a main "
      "view, and a template shared between views keeps one entry.")
     (figure "Registration: Collect maps template ids to handlers; main is required."
             (part "add-entry" (mf add-entry))
             (part "attr-exprs" (mf attr-exprs))
             (part "collect" (mf collect))
             (part "collect-all" (mf collect-all))
             (part "register" (mf register))))
    (sect
     "Render contexts and view selection"
     (string-append
      "A RenderContext holds the current value, binds, provided values, the view stack "
      "and the depth. Entering a frame adds one depth and captures the component's "
      "providers there, shadowing outer ones; a loop item's view keeps the depth and "
      "clears the binds. best-view picks the view to render: the explicit name, then the "
      "view stack, then main.")
     (figure "RenderContext."
             (part "enter-frame: one more path frame; providers captured at its depth" (mf enter-frame))
             (part "merge-dyn" (mf merge-dyn))
             (part "root-ctx" (mf root-ctx))
             (part "for-item-view" (mf for-item-view)))
     (figure "View selection: explicit name, then the view stack, then main."
             (part "best-view" (mf best-view))
             (part "best-view-in" (mf best-view-in))))
    (sect
     "Evaluation"
     (string-append
      "Every template node has one eval rule. A render source enters a frame (a field, "
      "the selected item of a field, or a provider jump), and renderView evaluates the "
      "component's best view between balanced component metadata. Elements with handlers "
      "render a data-eid. Loops produce one keyed group per entry, with item metadata "
      "around the body, after the loop's hooks pick entries, keys and extra binds.")
     (figure "Steps for render sources, and renderView."
             (part "to-frame" (mf to-frame))
             (part "render-view" (mf render-view))
             (part "eval-attrs" (mf eval-attrs))
             (part "eid-props" (mf eid-props)))
     (figure "Evaluation: every template node has one eval."
             (part "eval" (mf eval)))
     (figure "Loops: one keyed group per entry, between item metadata."
             (part "eval-each" (mf eval-each))
             (part "eval-item" (mf eval-item))
             (part "eval-body" (mf eval-body))
             (part "render-root" (mf render-root)))))

   (chap
    "Events and tasks"
    (string-append
     "Closing the loop. An event on the DOM is routed back to a handler and the path of "
     "the component that owns it. It becomes a task, which runs as one atomic transaction "
     "over the root state, and the DOM is then morphed to the new root. Checked: after "
     "every drain, the DOM is the render of the root.")
    (sect
     "Event routing"
     (string-append
      "getEventInfoFor. The DOM holds no component references, only data-eid attributes "
      "and metadata comments. Routing walks from the target up, collects eids until the "
      "first component boundary, and reads the metadata enclosing each ancestor to rebuild "
      "the dispatch path; closing comments hide openings and look-alikes are skipped. The "
      "handler is the first one for the event type, innermost eid first, in the table of "
      "the class the path reaches. Checked: every element with handlers routes to the "
      "instance that rendered it.")
     (figure "From the event target back to a handler and its component's path."
             (lang Routing #:nts '(addr route info))
             (part "enclosing-meta" (mf enclosing-meta))
             (part "scan: closing comments hide openings; look-alikes are skipped" (mf scan))
             (part "walk: eids stop at the first component boundary" (mf walk)))
     (figure "Rebuilding the path and choosing the handler."
             (part "frames-of" (mf frames-of))
             (part "event-info" (mf event-info))))
    (sect
     "Host configurations"
     (string-append
      "What the host holds: the root state, the task queue, pending async replies, the DOM "
      "with identities and the vnodes and root it was rendered from, the events still to "
      "arrive, and the observations (logs, failures, renders). Tasks are plain, notify, "
      "ask or event, and target a base route plus a selector. eval-arg evaluates send "
      "arguments in the message context; route-event turns a DOM event into tasks.")
     (figure "Host configurations: root, queue, pending replies, DOM, vnodes, rendered root, events, observations."
             (lang Tasks #:nts '(kind tsk target route? evt obs outcome cfg))
             (part "eval-arg: send arguments in the message context" (mf eval-arg))
             (part "route-event" (mf route-event))))
    (sect
     "The task queue"
     (string-append
      "host-> has five rules: event routes against the current DOM, run commits one "
      "transaction, fail aborts one, resolve settles a pending async ask in any order, and "
      "render morphs the DOM when the root changed. Rules are enabled nondeterministically, "
      "which stands for the runtime's time slices and ticks. Any exception aborts the "
      "whole transaction: the root and the queue stay as they were.")
     (figure "The host as a reduction relation; handle-task runs one transaction."
             (fit (λ () (render-reduction-relation host-> #:style 'vertical)))
             (note "handle-task: read the leaf at the update path; run the task by kind (plain, notify, ask, event);"
                   "set the new leaf; freeze each child's selector against the new root. Any failure aborts"
                   "the transaction: the root stays and the children are discarded."))))))

;; ---- layout -----------------------------------------------------------------
;; A block is a pict in the page flow. break? starts a new page; tocs are the
;; contents entries it carries.
(struct block (pict break? tocs))
(struct toc-entry (level label))

;; A heading is kept with the figure after it: they form one block, and the
;; figure takes at most the height the heading leaves on a page.
(define (with-heading heading f)
  (vl-append block-gap heading (f (- text-height (pict-height heading) block-gap))))

(define (section-blocks s number chapter-heading)
  (define heading
    (vl-append 6
               (section-text (format "~a   ~a" number (section-title s)))
               (para (section-summary s))))
  (define headings
    (if chapter-heading (vl-append block-gap chapter-heading heading) heading))
  (match-define (cons first-figure figures) (section-figures s))
  (cons (block (with-heading headings first-figure) #f
               (list (toc-entry 1 (format "~a   ~a" number (section-title s)))))
        (for/list ([f (in-list figures)])
          (block (f text-height) #f '()))))

(define (chapter-blocks ch n)
  (define heading
    (vl-append 8
               (chapter-label-text (format "Chapter ~a" n))
               (title-text (chapter-title ch))
               (blank 0 2)
               (para (chapter-summary ch))))
  (define sections
    (append*
     (for/list ([s (in-list (chapter-sections ch))] [m (in-naturals 1)])
       (section-blocks s (format "~a.~a" n m) (and (= m 1) heading)))))
  (match-define (cons (block p _ tocs) rest) sections)
  (cons (block p #t (cons (toc-entry 0 (format "~a   ~a" n (chapter-title ch))) tocs))
        rest))

(define (body-blocks chapters)
  (append* (for/list ([ch (in-list chapters)] [n (in-naturals 1)])
             (chapter-blocks ch n))))

;; Greedily fill pages with blocks; a block never splits across pages.
(define (paginate blocks)
  (let loop ([blocks blocks] [page '()] [height 0] [pages '()])
    (define (next-page) (if (null? page) pages (cons (reverse page) pages)))
    (match blocks
      ['() (reverse (next-page))]
      [(cons b rest)
       (define h (+ (pict-height (block-pict b)) (if (null? page) 0 block-gap)))
       (if (and (pair? page) (or (block-break? b) (> (+ height h) text-height)))
           (loop blocks '() 0 (next-page))
           (loop rest (cons b page) (+ height h) pages))])))

;; the page each contents entry lands on
(define (toc-pages pages first-page)
  (for*/list ([(blocks i) (in-indexed pages)]
              [b (in-list blocks)]
              [e (in-list (block-tocs b))])
    (cons e (+ first-page i))))

(define (toc-line entry page)
  (define indent (* 18 (toc-entry-level entry)))
  (define style (if (zero? (toc-entry-level entry)) (cons 'bold serif) serif))
  (define label (inset (text (toc-entry-label entry) style 10) indent 0 0 0))
  (define number (text (number->string page) style 10))
  (rb-superimpose (lb-superimpose (blank text-width (pict-height label)) label) number))

(define (front-blocks entries)
  (append
   (list (block (vl-append 10
                           (blank 0 40)
                           (doc-title-text doc-title)
                           (subtitle-text doc-subtitle)
                           (blank 0 16))
                #f '()))
   (for/list ([p (in-list abstract)]) (block (para p) #f '()))
   (list (block (vl-append 10
                           (section-text "Contents")
                           (apply vl-append 5
                                  (for/list ([e (in-list entries)])
                                    (toc-line (car e) (cdr e)))))
                #t '()))))

(define (page-pict blocks n)
  (define body (apply vl-append block-gap (map block-pict blocks)))
  (define footer (caption-text (number->string n)))
  (lt-superimpose
   (blank page-width page-height)
   (inset body margin-x margin-top 0 0)
   (inset (cc-superimpose (blank page-width 0) footer)
          0 (- page-height (/ margin-bottom 2)) 0 0)))

;; ---- output ---------------------------------------------------------------
;; The contents only need the number of front pages, which does not depend on
;; the page numbers it lists, so the front matter is laid out twice.
(define pages
  (with-atomic-rewriters
   (['none "∅"])
   (with-unquote-rewriter
    unquote-rewriter
    (let* ([body (paginate (body-blocks (content)))]
           [front-count (length (paginate (front-blocks (toc-pages body 1))))]
           [front (paginate (front-blocks (toc-pages body (add1 front-count))))])
      (append front body)))))

(define dc
  (new pdf-dc%
       [interactive #f]
       [as-eps #f]
       [use-paper-bbox #f]
       [width page-width]
       [height page-height]
       [output out]))
(send dc start-doc "semantics")
(for ([blocks (in-list pages)] [n (in-naturals 1)])
  (send dc start-page)
  (draw-pict (page-pict blocks n) dc 0 0)
  (send dc end-page))
(send dc end-doc)
(printf "wrote ~a (~a pages)\n" out (length pages))
