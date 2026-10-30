#lang racket
;; M0's scenarios. They live apart from core.rkt because check.rkt requires it.
(module+ test
  (require rackunit "core.rkt" "engine.rkt" "check.rkt")
  (define (cfg0 kinds host events #:policy [p 'by-path])
    (make-config #:kinds kinds #:root 'Root #:host host #:events events #:policy p))
  (define (logs c) (for/list ([o (config-obs c)] #:when (eq? (car o) 'log)) (second o)))

  ;; A counter: inc from the environment, a notification the host logs.
  (define counter
    '((kind Root (state (n 0))
            ()
            ((on (send inc) () ((set n (+ (get n) 1)) (notify changed (get n))))))))
  (define log-changes '(host ((on (notify changed) (x) ((log x) stop)))))
  (check-equal? (list->set (map logs (finals tree-> (cfg0 counter log-changes '((ev () inc) (ev () inc))))))
                (set '(1 2)))

  ;; Two requests answered by the host: the responses arrive in either order,
  ;; and each one is delivered exactly once.
  (define two
    '((kind Root (state)
            ()
            ((on (send go) () ((request a) (request b)))
             (on (ok a) (x) ((log x)))
             (on (ok b) (x) ((log x)))))))
  (define answers '(host ((on (request a) () ((answer ok 1))) (on (request b) () ((answer ok 2))))))
  (let ([c (cfg0 two answers '((ev () go)))])
    (check-equal? (list->set (map logs (finals tree-> c))) (set '(1 2) '(2 1)))
    (check-false (counterexample tree-> c p1-identity))
    (check-false (counterexample tree-> c p2-exactly-once))
    (check-false (counterexample tree-> c p3-sound)))

  ;; A request nobody answers: the host makes the response unhandled.
  (let ([c (cfg0 '((kind Root (state) ()
                         ((on (send go) () ((request lost)))
                          (on (unhandled lost) () ((log "unhandled"))))))
                 '(host ()) '((ev () go)))])
    (check-equal? (map logs (finals tree-> c)) '(("unhandled"))))

  ;; One handler's effects run in the order it emitted them: send-at () to
  ;; itself, a notify the host replies to, and a reply to the env event's
  ;; sender (the host).
  (define order
    '((kind Root (state)
            ()
            ((on (send go) () ((send-at () self 1) (notify note) (reply back)))
             (on (send self) (x) ((log "self")))
             (on (send ack) () ((log "ack")))))))
  (define replier '(host ((on (notify note) () ((reply ack) stop))
                          (on (send back) () ((log "back"))))))
  (check-equal? (map logs (finals tree-> (cfg0 order replier '((ev () go)))))
                '(("self" "back" "ack")))

  ;; Replies go back and forth: every message carries its sender.
  (define ping
    '((kind Root (state)
            ()
            ((on (send ping) (x) ((log x) (if (< x 4) ((reply pong (+ x 1))) ())))))))
  (define pong '(host ((on (send pong) (x) ((reply ping (+ x 1)))))))
  (check-equal? (map logs (finals tree-> (cfg0 ping pong '((ev () ping 0))))) '((0 2 4)))

  ;; Env events skip the queue: a second inc that arrives before the first
  ;; one's queued message runs is seen by it.
  (define slow
    '((kind Root (state (n 0))
            ()
            ((on (send inc) () ((set n (+ (get n) 1)) (send-at () seen)))
             (on (send seen) () ((log (get n))))))))
  (check-equal? (list->set (map logs (finals tree-> (cfg0 slow '(host ()) '((ev () inc) (ev () inc))))))
                (set '(1 2) '(2 2)))

  ;; An urgent response runs when it arrives; a normal one waits behind the
  ;; queue. Here the queue holds the root's own follow-up.
  (define (urgency req)
    `((kind Root (state)
            ()
            ((on (send go) () ((,req fetch) (send-at () later)))
             (on (send later) () ((log "later")))
             (on (ok fetch) (x) ((log "fetched")))))))
  (define fetcher '(host ((on (request fetch) () ((answer ok 0))))))
  (check-equal? (list->set (map logs (finals tree-> (cfg0 (urgency 'request) fetcher '((ev () go))))))
                (set '("later" "fetched")))
  (check-equal? (list->set (map logs (finals tree-> (cfg0 (urgency 'request/urgent) fetcher '((ev () go))))))
                (set '("later" "fetched") '("fetched" "later")))

  ;; Every policy agrees when there is nothing to move.
  (check-true (policies-agree? tree-> (λ (p) (cfg0 two answers '((ev () go)) #:policy p))
                               '(by-path by-path-checked by-identity)))

  ;; A script can leave the event open: one of several, any of them.
  (check-equal? (list->set (map logs (finals tree-> (cfg0 slow '(host ()) '((one-of (ev () inc) (ev () nothing)))))))
                (set '(1) '())))
