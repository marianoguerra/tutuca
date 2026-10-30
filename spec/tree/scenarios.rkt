#lang racket
;; Scenarios for the explorable (export.rkt): small programs, one or two per
;; tier, each showing what its tier changes. A scenario is a name, a title, a
;; blurb, the tier's relation and a configuration.
(require (prefix-in m0: "core.rkt") (prefix-in m1: "fields.rkt") (prefix-in m2: "grow.rkt")
         (prefix-in m3: "clear.rkt") (prefix-in m4: "replace.rkt") (prefix-in m5: "reorder.rkt")
         (prefix-in m6: "swap.rkt") (prefix-in m7: "fsm.rkt"))
(provide (struct-out scenario) scenarios)

(struct scenario (name tier title blurb rel config))

;; ---- M0 ----------------------------------------------------------------------
(define two-requests
  '((kind Root (state)
          ()
          ((on (send go) () ((request a) (request b)))
           (on (ok a) (x) ((log x)))
           (on (ok b) (x) ((log x)))))))
(define answers '(host ((on (request a) () ((answer ok 1))) (on (request b) () ((answer ok 2))))))

(define ping
  '((kind Root (state)
          ()
          ((on (send ping) (x) ((log x) (if (< x 4) ((reply pong (+ x 1))) ())))))))
(define pong '(host ((on (send pong) (x) ((reply ping (+ x 1)))))))

;; ---- M1 ----------------------------------------------------------------------
(define panel-kinds
  '((kind Counter (state (n 0))
          ()
          ((on (send inc) () ((set n (+ (get n) 1)) (notify changed (get n)) (request total (get n))))
           (on (send seen) (who) ((log who)))
           (on (ok total) (x) ((log x)))))
    (kind Panel (state)
          ((c (new Counter)))
          ((on (notify changed) (x) ((reply seen "panel")))))
    (kind App (state)
          ((panel (new Panel)))
          ((on (notify changed) (x) ((reply seen "app") stop))
           (on (request total) (x) ((answer ok (+ x 1000))))))))

;; ---- M2 ----------------------------------------------------------------------
(define todo-kinds
  '((kind Item (state (label 0) (ready 0))
          ()
          ((on (send init) () ((set ready 1)))
           (on (send go) () ((request fetch (get label))))
           (on (ok fetch) (x) ((log x)))))
    (kind Todos (state (count 0))
          ((items (list)))
          ((on (send push) ()
               ((set count (+ (get count) 1))
                (append items (new Item (label (get count))))
                (send-at ((index items (- (len items) 1))) init)))
           (on (request fetch) (l) ((answer ok (+ l 100))))))))

;; ---- M3 ----------------------------------------------------------------------
(define board-kinds
  '((kind Item (state (label 0))
          ()
          ((on (send ping-me) () ((notify ping)))))
    (kind Group (state) ((item (new Item))) ())
    (kind Board (state)
          ((groups (list)))
          ((on (send push) () ((append groups (new Group))))
           (on (send drop) (i) ((clear groups i)))
           (on (notify ping) () ((log "ping") stop))))))

;; ---- M4, M5 ------------------------------------------------------------------
(define asker
  '(kind Item (state (label 0))
         ()
         ((on (send go) () ((request fetch)))
          (on (ok fetch) (x) ((log (+ (get label) x))))
          (on (send poke) () ((log (get label)))))))
(define replacing
  `(,asker
    (kind Items (state)
          ((items (list)))
          ((on (send push) () ((append items (new Item (label 10)))))
           (on (send renew) (i) ((put items i (new Item (label 20)))))
           (on (request fetch) () ((answer ok 100)))))))
(define reordering
  `(,asker
    (kind Items (state)
          ((items (list)))
          ((on (send push) () ((append items (new Item (label 10)))))
           (on (send unshift) () ((prepend items (new Item (label 20)))))
           (on (send poke-first) () ((send-at ((index items 0)) poke)))
           (on (request fetch) () ((answer ok 100)))))))

;; ---- M6 ----------------------------------------------------------------------
(define deck-kinds
  '((kind Card (state (label 10))
          ()
          ((on (send go) () ((request fetch)))
           (on (ok fetch) (x) ((log (+ (get label) x))))
           (on (send to-note) () ((swap (new Note))))))
    (kind Note (state) () ())
    (kind Deck (state)
          ((cards (list)))
          ((on (send push) () ((append cards (new Card))))
           (on (request fetch) () ((answer ok 100)))))))

;; ---- M7 ----------------------------------------------------------------------
(define loader
  '((kind Loader (state)
          ()
          ()
          (states idle
                  (idle (on (send load) () ((request fetch) (goto loading))))
                  (loading (on (ok fetch) (x) ((log x) (goto done)))
                           (on (send cancel) () ((goto idle))))
                  (done)))))
(define fetching-host '(host ((on (request fetch) () ((answer ok 1))))))

(define scenarios
  (list
   (scenario "requests" "M0" "Two requests, answered in any order"
             (string-append "The root asks the host twice. The host answers both at once, but the responses "
                            "arrive in either order: arrivals are the model's only nondeterminism.")
             m0:tree-> (m0:make-config #:kinds two-requests #:root 'Root #:host answers
                                       #:events '((ev () go))))
   (scenario "ping-pong" "M0" "Replies go back and forth"
             (string-append "Every message carries its sender, so every handler can reply. The root and the "
                            "host reply to each other until the count reaches 4.")
             m0:tree-> (m0:make-config #:kinds ping #:root 'Root #:host pong #:events '((ev () ping 0))))
   (scenario "hops" "M1" "One notification, a reply from each hop"
             (string-append "The counter notifies; the panel replies and passes it on, the app replies and "
                            "stops it. The request passes the panel and the app answers it. All hops run in "
                            "one turn; their replies wait in the queue.")
             m1:fields-> (m1:make-config #:kinds panel-kinds #:root 'App
                                         #:events '((ev ((field panel) (field c)) inc))))
   (scenario "append-init" "M2" "Append an item, then init it"
             (string-append "The list appends an item and sends init to it in the same transaction. The item "
                            "isn't in the tree the handler read, but send-at is resolved against the committed "
                            "tree, where it is.")
             m2:grow-> (m2:make-config #:kinds todo-kinds #:root 'Todos
                                       #:events '((ev () push) (ev ((index items 0)) go))))
   (scenario "lost-bubble" "M3" "Hop by hop, a bubble can be lost"
             (string-append "Under per-hop granularity, the rest of a bubble waits in the queue after each hop. "
                            "If the group it passed through is cleared meanwhile, the bubble is lost. Under the "
                            "default, turn, it can't be.")
             m3:clear-> (m3:make-config #:kinds board-kinds #:root 'Board #:gran 'per-hop
                                        #:events '((ev () push) (ev ((index groups 0) (field item)) ping-me)
                                                   (ev () drop 0))))
   (scenario "replace-by-path" "M4" "Replaced while asking, by path"
             (string-append "An item asks for something, and its place gets a new item before the answer "
                            "arrives. By path, the newcomer gets the answer: a misdelivery.")
             m4:replace-> (m4:make-config #:kinds replacing #:root 'Items #:policy 'by-path
                                          #:events '((ev () push) (ev ((index items 0)) go) (ev () renew 0))))
   (scenario "replace-by-identity" "M4" "Replaced while asking, by identity"
             (string-append "The same race by identity: the asker is gone, so its answer is orphaned instead "
                            "of misdelivered.")
             m4:replace-> (m4:make-config #:kinds replacing #:root 'Items #:policy 'by-identity
                                          #:events '((ev () push) (ev ((index items 0)) go) (ev () renew 0))))
   (scenario "reorder-anchored" "M5" "Prepended while a send-at waits, anchored"
             (string-append "The list sends poke to items[0], then an item is prepended before it runs. "
                            "Anchored, the poke goes to whatever is first now; by identity it would follow "
                            "the item that was.")
             m5:reorder-> (m5:make-config #:kinds reordering #:root 'Items #:policy 'anchored
                                          #:events '((ev () push) (ev () poke-first) (ev () unshift))))
   (scenario "reorder-by-identity" "M5" "Prepended while a send-at waits, by identity"
             "The same race by identity: the poke follows the item it was meant for."
             m5:reorder-> (m5:make-config #:kinds reordering #:root 'Items #:policy 'by-identity
                                          #:events '((ev () push) (ev () poke-first) (ev () unshift))))
   (scenario "swap-kind" "M6" "Swapped for another kind while asking"
             (string-append "A card asks, then turns itself into a note. By path, the note gets the card's "
                            "answer, and has no handler for it.")
             m6:swap-> (m6:make-config #:kinds deck-kinds #:root 'Deck
                                       #:events '((ev () push) (ev ((index cards 0)) go)
                                                  (ev ((index cards 0)) to-note))))
   (scenario "cancelled-load" "M7" "A response to a state that moved on"
             (string-append "The loader asks and moves to loading; it can be cancelled back to idle before the "
                            "answer arrives. The answer reaches the right instance, in a state with no handler "
                            "for it.")
             m7:fsm-> (m7:make-config #:kinds loader #:root 'Loader #:host fetching-host
                                      #:events '((ev () load) (ev () cancel))))))
