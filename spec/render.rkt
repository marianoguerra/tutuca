#lang racket
;; Typesets the spec layers into semantics.pdf, laid out like a paper on
;; A4 pages:
;;   racket spec/render.rkt
(require redex/pict pict racket/draw racket/runtime-path
         "data.rkt" "component/paths.rkt" "component/expr.rkt" "component/types.rkt"
         "component/class.rkt" "component/action.rkt"
         "view/sem.rkt" "view/normalize.rkt" "view/view.rkt" "view/route.rkt" "view/wf.rkt"
         "bind/meta.rkt" "bind/lower.rkt" "bind/decode.rkt" "system/host.rkt"
         "vdom/vnode.rkt" "vdom/dom.rkt" "vdom/keys.rkt" "vdom/morph.rkt")

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
(define (wrap-words str style size [width text-width])
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

(define (para str) (wrap-words str serif 10))

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
        'string-downcase "lower"
        'string? "isString"
        'boolean? "isBoolean"
        'finite-number? "isFinite"))

;; Racket constants written as unquotes, shown as their value.
(define escape-consts (hash 'META-CLOSE "\"§/§\"" 'HTML-NS "HTML-NS"))

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
    [(? symbol? c)
     #:when (hash-has-key? escape-consts c)
     (struct-copy lw l [e (hash-ref escape-consts c)] [unq? #f])]
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
(define-syntax-rule (jf name) (fit (λ () (render-judgment-form name))))
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
     (wrap-words label serif 10)))
  (λ (max-height)
    (define over (- (pict-height (framed body)) max-height))
    (framed (if (positive? over)
                (scale body (/ (- (pict-height body) over) (pict-height body)))
                body))))


;; ---- document structure -----------------------------------------------------
;; Chapters go from the bottom of the framework to the top: each one only uses
;; what the chapters before it define, and appendices only what they say they
;; use. Numbers are assigned when laying out.
(struct chapter (title summary sections appendix?))
(struct section (title summary figures))

(define (chap title summary . sections) (chapter title summary sections #f))
(define (appx title summary . sections) (chapter title summary sections #t))
(define (sect title summary . figures) (section title summary figures))

;; ---- content --------------------------------------------------------------
(define (note . lines) (apply vl-append 4 (map caption-text lines)))

(define doc-title "A Formal Model of Tutuca")
(define doc-subtitle "Components, views, and the binding that lowers them to a virtual DOM")

(define abstract
  (list
   (string-append
    "This document specifies the meaning of tutuca as a PLT Redex model. Tutuca's side is "
    "declarative, in three parts. Components are classes: typed fields, invariants, and a "
    "protocol of messages whose handlers are deterministic steps from one instance to the "
    "next, in the style of TLA+. Views evaluate to a semantic tree that says which parts are "
    "the render of a component, which are rendered at a frame, and which are the items of a "
    "loop; events on the tree route to messages. The host composes them into a task queue.")
   (string-append
    "A binding layer lowers the semantic tree to virtual DOM nodes, encoding wrappers as "
    "metadata comments and handlers as data-eid attributes, and decodes events back from "
    "the DOM. The binding theorem checks that decoding agrees with routing on the semantic "
    "tree. The virtual DOM itself, with reconciliation and node identity, knows nothing "
    "about tutuca and is specified in Appendix A.")
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
      "objects: JS functions appear later as expression terms (Chapter 3).")
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
    "Paths"
    (string-append
     "How places are named. There are four kinds of path, one per job: update paths "
     "address state, dispatch paths record rendered ancestry, selectors describe targets "
     "read at commit time, and routes pair a dispatch path with its update path. A route is "
     "where a message is delivered, so paths come before components and views.")
    (sect
     "Kinds of path"
     (string-append
      "The syntax of frames, dispatch paths, update paths, selectors and routes. A frame "
      "reads its keys, then its item key, from its base: the previous frame's value, or "
      "the value a provider captured at some render depth. get-in and set-in are getIn "
      "and setIn, the only operations that touch state through an update path.")
     (figure "Update paths, dispatch frames, selectors and routes are different things."
             (lang Paths #:nts '(skey base item? dframe dpath upath route pb-op sel))
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
     "sourceKey and frames"
     (string-append
      "sourceKey is the item key of the frame that leads out of the receiver's view, or "
      "null when the receiver itself or an ancestor sent the message. promote marks the "
      "frame before a component boundary as a component frame, and item-frame is the frame "
      "a loop item adds over its source.")
     (figure "sourceKey, component frames and item frames."
             (part "source-key-in" (mf source-key-in))
             (part "key-at" (mf key-at))
             (part "frame-item-key" (mf frame-item-key))
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
    "Components"
    (string-append
     "The model half of component(): what state an instance holds and which messages it "
     "handles. A class has typed fields, invariants, and a protocol: each message has a "
     "contract and a handler. Instances are values, with no identity and no inheritance; "
     "where an instance lives is its only identity. A handler is an action in the style of "
     "TLA+, a deterministic step from self to next together with the effects it emits.")
    (sect
     "Expressions"
     (string-append
      "The pure JavaScript a component supplies, as a small language. Field predicates, "
      "invariants, contracts, handler bodies, loop hooks and scope binds are all terms in "
      "it. A throw is an undefined evaluation.")
     (figure "Expressions."
             (lang Expr #:nts '(x env hx))
             (part "eval-hx" (mf eval-hx))))
    (sect
     "Field types"
     (string-append
      "The t.* builders of schema.js as terms. valid is isValid: the value has the type's "
      "kind and meets its constraints. An index is a key of another field of the owner, the "
      "component holding the field; inside arrays, maps and records there is no owner. "
      "make-field keeps a valid argument and otherwise takes the default, which must meet "
      "the constraints; a record makes each key, and a union its first alternative, the "
      "same way. Checked: make keeps valid arguments, and yields a valid value whenever "
      "every .default(v) has its type.")
     (figure "Field types, constraints and owners."
             (lang Types #:nts '(ty check owner arg?)))
     (figure "valid: isValid."
             (jf valid))
     (figure "Making a field: defaults, constraints, make."
             (part "default-of: makeDefault; none for a required component or an empty index" (mf default-of))
             (part "meets?: only the type's own constraints" (mf meets?))
             (part "make-field" (mf make-field))))
    (sect
     "Classes and protocols"
     (string-append
      "A class: fields with their types, invariants on self, and handlers. A handler's "
      "contract is MessageSpec: argument types, the source key's type, pre on self and the "
      "arguments, post relating self and next, and the messages it may emit. Its body is "
      "one step or cases, the first enabled one running. A step's updates assign into next, "
      "reading self only; a field no update names is unchanged. Its effects run in order "
      "and may read next.")
     (figure "Classes, contracts and actions."
             (lang Class #:nts '(class-def csection handler contract emit-kind body part lv eff))))
    (sect
     "Actions and checks"
     (string-append
      "act steps one instance: it picks the first enabled case, applies the updates over "
      "self (or the replacement become names), and evaluates the effects. A body with no "
      "enabled case, or an effect that fails, aborts; effects evaluated before the abort "
      "survive, as JS side effects do. message-issues checks a handled message against its "
      "contract, like messageIssues. invalid-in is findInvalidFields: undeclared and invalid "
      "fields, then broken invariants, skipping subtrees that did not change. Checked: a "
      "handler refines its contract from every valid state meeting pre.")
     (figure "Evaluated effects and the outcome of a step."
             (lang Action #:nts '(fx stepped issue))
             (note "act(class, self, m, args, sourceKey): the first case whose guard is truthy;"
                   "next = become or self, then each update next.p = e with e read against self;"
                   "then each effect in order, against self and next. fail, a throw, or no enabled"
                   "case gives (aborted fx...), the effects evaluated before it."))))

   (chap
    "Views"
    (string-append
     "The view half of component(): templates of expressions that evaluate to a semantic "
     "tree. Elements keep their handlers, and wrapper nodes say what the tree means: this "
     "is the render of a component, this is rendered at a frame, these are the items of a "
     "loop. Routing is defined on that tree, and well-formed views only send messages the "
     "class handles. How the DOM records any of this is Chapter 5's business.")
    (sect
     "The semantic tree"
     (string-append
      "Elements with props and handlers, text, the view's own comments, explicit "
      "fragments, and three wrappers: component, enter (rendered at a frame: a field, the "
      "selected item of a field, or a provided value) and items, one entry per loop item "
      "with its key and frame. normalize is addChild: arrays and fragments splice, null "
      "drops out, nodes stay, other values become text.")
     (figure "The semantic tree: elements keep their handlers; wrappers say what their children are."
             (lang Sem #:nts '(tag ns? tid key? prop-value on-attr action arg snode entry)))
     (figure "addChild: from evaluated results to a flat node sequence."
             (lang Norm #:nts '(result))
             (part "normalize" (mf normalize))
             (part "key-of: key != null ? String(key) : undefined" (mf key-of))))
    (sect
     "View syntax"
     (string-append
      "A view definition belongs to a class: views, loops, scopes and provides. "
      "component() is both halves in one form; registration splits it. Every form a "
      "template can use: field, seqItem, provided, lookupBind, $if, h, render, each, "
      "renderEach, renderIt, scope and pushView, plus constants and multi-root fragments.")
     (figure "View definitions, expressions, attributes and render contexts."
             (lang View #:nts '(view-def vsection loop loop-opt component-def e src attr ctx binds dyn
                                table registration registry))))
    (sect
     "Registration"
     (string-append
      "component() and the Collect walker. Each class gets one table from template id to "
      "the event handlers of that element, built by walking every view: an element's "
      "entry, then its attribute expressions, then its children. A class needs a main "
      "view, and a template shared between views keeps one entry.")
     (figure "Registration: split the halves; Collect maps template ids to handlers."
             (part "split-component" (mf split-component))
             (part "add-entry" (mf add-entry))
             (part "collect" (mf collect))
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
      "Every template node has one eval rule. A render source enters a frame and wraps "
      "the component's render; renderView evaluates the component's best view inside a "
      "component wrapper. Loops make one entry per item, after the loop's hooks pick "
      "entries, keys and extra binds.")
     (figure "Render sources and renderView."
             (part "to-frame" (mf to-frame))
             (part "render-view" (mf render-view))
             (part "eval-attrs" (mf eval-attrs)))
     (figure "Evaluation: every template node has one eval."
             (part "eval" (mf eval)))
     (figure "Loops: one entry per item, with its key and frame."
             (part "eval-each" (mf eval-each))
             (part "eval-item" (mf eval-item))
             (part "eval-body" (mf eval-body))
             (part "render-root" (mf render-root))))
    (sect
     "Routing on the tree"
     (string-append
      "Which handler an event on an element runs, and where. An element's dispatch path is "
      "the frames of the wrappers above it, a component wrapper making the frame before it "
      "a component frame. Its candidate handlers are its own, then those of the elements "
      "above it up to the nearest component wrapper; the first for the event's type wins.")
     (figure "Sites: each element with its handler chain and dispatch path."
             (part "sites-of" (mf sites-of))
             (part "sites-in" (mf sites-in))
             (part "site-info" (mf site-info))))
    (sect
     "Well-formed views"
     (string-append
      "Every event binding sends a message of the class's protocol, with the arity its "
      "contract declares and constants of the declared types: lint's unknown-handler, "
      "send-arity and send-arg-type. Checked: on random trees of well-formed components, "
      "every event finds its handler.")
     (figure "Well-formed sends, registrations and registries."
             (jf wf-send)
             (jf wf-registration)
             (jf wf-registry))))

   (chap
    "Binding"
    (string-append
     "What binds the declarative side to the virtual DOM of Appendix A. Lowering encodes "
     "each wrapper as a metadata comment, its children and a closing comment, and each "
     "element with handlers as a data-eid attribute. Decoding reads them back from the "
     "DOM. Checked, the binding theorem: for every element of a semantic tree, decoding "
     "the rendered lowering picks the same handler and route as routing on the tree. With "
     "the virtual DOM's own theorem, the same holds on every DOM the host morphs into.")
    (sect
     "Metadata"
     (string-append
      "A metadata comment says what the wrapper it opens is: a component boundary or one "
      "path frame, as JSON between § marks. A frame's cf flag is not written: decoding "
      "restores it from the component boundary that follows.")
     (figure "Metadata: what an opening comment says."
             (lang Meta #:nts '(meta))
             (part "frame-meta: cf is not written" (mf frame-meta))
             (part "meta-frame" (mf meta-frame))))
    (sect
     "Lowering"
     (string-append
      "From the semantic tree to vnodes. Wrappers become balanced comments; a loop becomes "
      "an unkeyed group of keyed item groups, each loop its own sibling key scope; an "
      "element with handlers gets data-eid; elements in props become vnode values.")
     (figure "Lowering wrappers to comments and handlers to data-eid."
             (part "wrap" (mf wrap))
             (part "eid-props" (mf eid-props))
             (part "lower" (mf lower))
             (part "lower-entry" (mf lower-entry))
             (part "lower-all" (mf lower-all))
             (part "lower-root" (mf lower-root))))
    (sect
     "Decoding events"
     (string-append
      "getEventInfoFor. The DOM holds no component references, only data-eid attributes "
      "and metadata comments. Decoding walks from the target up, collects eids until the "
      "first component boundary, and reads the metadata enclosing each ancestor to rebuild "
      "the dispatch path; closing comments hide openings and look-alikes are skipped. The "
      "handler is the first one for the event type, innermost eid first, in the table of "
      "the class the path reaches.")
     (figure "From the event target back to a handler and its component's path."
             (lang Routing #:nts '(addr info))
             (part "enclosing-meta" (mf enclosing-meta))
             (part "scan: closing comments hide openings; look-alikes are skipped" (mf scan))
             (part "walk: eids stop at the first component boundary" (mf walk)))
     (figure "Rebuilding the path and choosing the handler."
             (part "frames-of" (mf frames-of))
             (part "event-info" (mf event-info))
             (note "Checked: event-info(render(lower-root(r, root)), a_i) = site-info(site_i)"
                   "for the i-th element, on random component trees."))))

   (chap
    "The host"
    (string-append
     "Closing the loop. An event on the DOM is decoded into a task, which runs as one "
     "atomic transaction over the root state, and the DOM is then morphed to the new root. "
     "Read as TLA+, a configuration is the state and the reduction relation is Next: each "
     "rule is one action, and all of the system's nondeterminism is which rule fires. "
     "Checked: after every drain, the DOM is the render of the root.")
    (sect
     "Host configurations"
     (string-append
      "What the host holds: the root state, the task queue, pending async replies, the DOM "
      "with identities and the vnodes and root it was rendered from, the events still to "
      "arrive, the observations (logs, failures, renders and dev-mode reports), the next "
      "fresh label, and the root when the queue was last empty. Tasks are plain, notify, "
      "ask or event, and target a base route plus a selector.")
     (figure "Host configurations."
             (lang Tasks #:nts '(kind tsk target route? ask-def ask-result evt obs outcome cfg))
             (part "eval-arg: send arguments in the message context" (mf eval-arg))
             (part "route-event" (mf route-event))))
    (sect
     "The task queue"
     (string-append
      "host-> has six rules: event decodes against the current DOM, run commits one "
      "transaction, fail aborts one, resolve settles a pending async ask in any order, "
      "render morphs the DOM when the root changed, and settle checks the invariants once "
      "the queue is empty. Any exception aborts the whole transaction: the root and the "
      "queue stay as they were. After a commit, the fields that changed are checked against "
      "their types and the handler that ran against its contract; invariants wait for the "
      "queue to empty, since a task may break them for a task it queued.")
     (figure "The host as a reduction relation; handle-task runs one transaction."
             (fit (λ () (render-reduction-relation host-> #:style 'vertical)))
             (note "handle-task: read the leaf at the update path; run the task by kind (plain, notify, ask, event),"
                   "stepping the handler with act; set the new leaf; freeze each child's selector against the new"
                   "root; report invalid fields and contract issues. Any failure aborts the transaction.")))
    (sect
     "Settled states"
     (string-append
      "checkSettled: when the queue is empty and the root changed since it last was, the "
      "invariants of what changed are reported.")
     (figure "Invariants hold of settled states."
             (part "settle-reports" (mf settle-reports)))))

   (appx
    "Virtual DOM"
    (string-append
     "vdom.js, which knows nothing about tutuca: normalized vnodes, the DOM they render to, "
     "and reconciliation of an existing DOM against new vnodes. DOM nodes carry labels that "
     "stand for their identity, so the model says which nodes survive a morph, not only "
     "what the DOM looks like after it. Checked: erase(morph(mount(old), old, new)) = "
     "render(new), and morphing a tree into itself keeps every label. The binding relies "
     "on nothing else.")
    (sect
     "Normalized vnodes"
     (string-append
      "Elements, wrapperless groups with an optional key, text and comments. An element "
      "carries its template id tid, which is its Shape: only elements of the same template "
      "are the same kind. Props are sorted by name, since attribute order is not "
      "observable, and svg and math set their own namespace.")
     (figure "Normalized vnodes. tid is the element's template (its Shape); props are sorted by name."
             (lang VDom #:nts '(tag ns ns? tid key? prop-name prop-value prop leaf node)))
     (figure "Element construction."
             (part "shape-of: svg and math set their own namespace" (mf shape-of))
             (part "make-el: new VNode(shape, values, childs, key)" (mf make-el))))
    (sect
     "DOM output"
     (string-append
      "toDom into a fresh container. Groups contribute their children with no wrapper, "
      "and the namespace flows from parent to child, with foreignObject switching SVG back "
      "to HTML. A fresh render is the reference every reconciliation must agree with.")
     (figure "DOM output: groups have no wrapper."
             (lang DOM #:nts '(dom))
             (part "child-ns: foreignObject resets SVG to HTML" (mf child-ns))
             (part "to-dom" (mf to-dom))
             (part "render-into" (mf render-into))
             (part "render: the container's children" (mf render))))
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
             (lang Morph #:nts '(lbl ldom lgroups out))
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
      "range and mounts the rest. It matches against the nodes render made only: foreign "
      "nodes, which other code put in a rendered element, don't shift the match and stay.")
     (figure "morphNode: same leaf kind, or same template and key, keeps the node."
             (part "morph-node" (mf morph-node)))
     (figure "morphChildren: matched targets reuse their source's DOM; the rest mount."
             (part "morph-children" (mf morph-children))
             (part "morph-seq" (mf morph-seq))
             (part "morph-one" (mf morph-one))
             (part "owned: the nodes render made" (mf owned))
             (part "keep-foreign: foreign nodes stay" (mf keep-foreign))
             (part "erase: forget identities" (mf erase))
             (part "erase-owned: what render made" (mf erase-owned))
             (note "Checked: erase(morph(mount(old), old, new)) = render(new); morph(x, x) keeps every label; with foreign nodes anywhere, erase-owned(morph(...)) = render(new) and the foreign nodes stay."))))))

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
               (chapter-label-text (format (if (chapter-appendix? ch) "Appendix ~a" "Chapter ~a") n))
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
  (define-values (main appendices) (partition (λ (ch) (not (chapter-appendix? ch))) chapters))
  (append (append* (for/list ([ch (in-list main)] [n (in-naturals 1)])
                     (chapter-blocks ch n)))
          (append* (for/list ([ch (in-list appendices)] [i (in-naturals)])
                     (chapter-blocks ch (string (integer->char (+ 65 i))))))))

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
