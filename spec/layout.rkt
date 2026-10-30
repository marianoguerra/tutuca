#lang racket
;; The page layout both PDFs share (render.rkt's semantics.pdf, and
;; tree/render.rkt's tree.pdf): A4 pages laid out like a paper, chapters of
;; sections of numbered figures, a contents page, and Racket escapes printed as
;; math-style calls.
(require redex/pict pict racket/draw)
(provide text-width para note part figure fit mf jf lang
         chap appx sect
         write-document)

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
;; String(atom), instead of highlighted Racket code. names maps a Racket
;; function to the name it prints as; consts maps a Racket constant written as
;; an unquote to the text it prints as.

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

(define ((unquote-rewriter names consts) l)
  (match (lw-e l)
    [(? symbol? c)
     #:when (hash-has-key? consts c)
     (struct-copy lw l [e (hash-ref consts c)] [unq? #f])]
    [(list open (lw (? symbol? f) _ _ _ _ _ _) args ... close)
     #:when (and (hash-has-key? names f) (andmap term-arg? args))
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
                                    [e (string-append (hash-ref names f) "(")]
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

(define (note . lines) (apply vl-append 4 (map caption-text lines)))

(define figure-count (make-parameter (box 0)))

;; a numbered figure: rules above and below, caption underneath. It is laid
;; out given the height it may take; a taller body is scaled down to fit.
(define (figure caption . parts)
  (define count (figure-count))
  (set-box! count (add1 (unbox count)))
  (define label (format "Figure ~a. ~a" (unbox count) caption))
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

(define (front-blocks title subtitle abstract entries)
  (append
   (list (block (vl-append 10
                           (blank 0 40)
                           (doc-title-text title)
                           (subtitle-text subtitle)
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
;; content is a thunk giving the chapters: they are typeset inside the
;; rewriters. The contents only need the number of front pages, which does not
;; depend on the page numbers it lists, so the front matter is laid out twice.
(define (write-document out #:title title #:subtitle subtitle #:abstract abstract
                        #:content content #:escape-names [names (hash)] #:escape-consts [consts (hash)]
                        #:atomic-rewriters [atomic '()])
  (define pages
    (parameterize ([figure-count (box 0)])
      (with-atomic-rewriters
       (['none "∅"])
       (with-unquote-rewriter
        (unquote-rewriter names consts)
        (let loop ([atomic atomic])
          (match atomic
            ['()
             (let* ([body (paginate (body-blocks (content)))]
                    [front-count (length (paginate (front-blocks title subtitle abstract (toc-pages body 1))))]
                    [front (paginate (front-blocks title subtitle abstract (toc-pages body (add1 front-count))))])
               (append front body))]
            [(cons (cons sym str) rest)
             (with-atomic-rewriter sym str (loop rest))]))))))
  (define dc
    (new pdf-dc%
         [interactive #f]
         [as-eps #f]
         [use-paper-bbox #f]
         [width page-width]
         [height page-height]
         [output out]))
  (send dc start-doc (path->string (path-replace-extension (file-name-from-path out) #"")))
  (for ([blocks (in-list pages)] [n (in-naturals 1)])
    (send dc start-page)
    (draw-pict (page-pict blocks n) dc 0 0)
    (send dc end-page))
  (send dc end-doc)
  (printf "wrote ~a (~a pages)\n" out (length pages)))
