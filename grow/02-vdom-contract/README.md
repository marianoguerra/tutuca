# 2. The vdom contract

**New words:** `node`, `text`, `comment`, `el`, `group`, `tid`, `makeEl`, `morph`.

The virtual DOM is given. This step reads its contract and writes the one file
of the reference implementation that touches it.

The contract, from `../../spec/vdom/vnode.rkt`:

    node ::= (el tid tag ns? key? (prop ...) (node ...))
           | (group key? (node ...))
           | (text string)
           | (comment string)

and one theorem, from `../../spec/vdom/morph.rkt`:

    erase(morph(mount(old), old, new)) = render(new)

Morphing the DOM from one tree of vnodes to another leaves the DOM that
rendering the new tree from nothing would make. So the rest of the series only
ever says what the tree is; it never says how the DOM gets there.

`tid` is an element's template identity. Two elements with the same `tid` and
key are the same element at two moments, and morph patches one into the other.
Two elements with different `tid`s replace each other, even with the same tag.

## Order of the session

1. Read the `node` grammar and `make-el` in `spec/vdom/vnode.rkt`.
2. Read the theorem; run `raco test spec/vdom/` to see it checked on random trees.
3. `src/bind/vnode.js`: `text`, `comment`, `group`, `makeEl`. The vdom wants a
   `Shape` per template; `makeEl` keeps one per `tid`, and nothing outside this
   file knows.
4. `morph` twice in a test: the first call builds, the second patches, and the
   `<p>` is the same DOM node after it.
5. `index.html`: the same in a browser.

## Runs at the end

    raco test grow/02-vdom-contract/spec/
    node --test "grow/02-vdom-contract/test/*.test.js"

and, serving the repository root, `grow/02-vdom-contract/index.html`.
