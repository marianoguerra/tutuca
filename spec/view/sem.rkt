#lang racket
;; The semantic tree: what evaluating a view produces.
;;
;; It says what the rendered tree means, not how the DOM records it. Elements
;; keep their event handlers, and wrapper nodes say that their children are the
;; render of a component, are rendered at a frame (a field, the selected item of
;; a field, or a provided value), or are the items of a loop. bind/lower.rkt
;; turns wrappers into the metadata comments, keyed groups and data-eid
;; attributes the runtime writes, and routing over the DOM reads them back.
(require redex/reduction-semantics "../component/class.rkt")
(provide Sem)

(define-extended-language Sem Class
  (tag ::= string)
  (ns ::= string)                          ; a namespace URI
  (ns? ::= ns none)                        ; none: the element inherits its parent's
  (tid ::= natural)                        ; the template the element comes from
  (key? ::= string none)
  (prop-name ::= (variable-except key namespace null))
  ;; Props retain element and iterable values without turning them into children.
  (prop-value ::= value snode (frag prop-value ...))
  (prop ::= (prop-name prop-value))
  ;; "on:<event>": action. Send arguments are evaluated on dispatch, against the
  ;; message context: literals, the event target's value, the source key, the
  ;; drag key (dragKey), or conditionals of those. Lint rejects state reads and
  ;; render binds there.
  (on-attr ::= (on fname action))
  (action ::= (send fname arg ...))
  (arg ::= value (target-value) (source-key) (drag-key) (if arg arg arg))
  (snode ::= (el tid tag ns? key? (prop ...) (on-attr ...) (snode ...))
             (text string)
             (comment string)                   ; a comment the view itself writes
             (group key? (snode ...))           ; an explicit fragment: a sibling key scope
             (component cname (snode ...))      ; the render of an instance of cname
             (enter dframe (snode ...))         ; rendered at a frame: field, seqItem, provided
             (items entry ...))                 ; a loop, one entry per item
  (entry ::= (item key? dframe (snode ...))))  ; an item's key, its frame, its body

(module+ test
  (test-equal (redex-match? Sem snode (term (el 0 "b" none none () ((on click (send go))) ()))) #t)
  (test-equal (redex-match? Sem snode
                            (term (enter (frame none ("child") none #t)
                                         ((component Child ((text "x")))))))
              #t)
  (test-equal (redex-match? Sem snode
                            (term (items (item "a" (frame none ("xs") 0 #f) ((text "a")))
                                         (item none (frame none ("xs") 1 #f) ()))))
              #t)
  ;; Wrappers hold normalized children.
  (test-equal (redex-match? Sem snode (term (component C ("x")))) #f)
  (test-results))
