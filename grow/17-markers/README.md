# 17. Markers

**New words:** `meta`, `meta->string`, `string->meta`, `META-CLOSE`, `wrap`
(`metaString`, `stringMeta`).

Soon something will happen on the page, and the question will be: whose is
this element? The semantic tree knows, it has a `component` node around it.
The DOM has to be told.

So the `component` clause of `lower` changes. A component wrapper becomes a
comment before its children and a comment after them:

    <!--§{"t":"component"}§--> <p>...</p> <!--§/§-->

The opening comment is **metadata**: JSON between two `§`. `meta->string`
writes it and `string->meta` reads it back, and reads nothing else: a comment
the application wrote, or one that only looks like metadata, is not metadata.

Comments are the one kind of DOM node that shows nothing, moves with its
siblings, and survives being copied as HTML. The vdom treats them as any other
node, so morphing keeps them in place for free.

## Session

1. `spec/bind/meta.rkt`: `meta`, `meta->string`, `string->meta`.
2. `lower.rkt`: `Lower` is now the union of `View`, `VDom` and `Meta`;
   `wrap`; the `component` clause.
3. `src/bind/meta.js`, and `wrap` in `lower.js`.
4. The tests of steps 14 and 15 now see the comments.

**Seam.** The `component` clause of `lower`, as step 14 said it would.

## Runs at the end

    raco test grow/17-markers/spec/
    node --test "grow/17-markers/test/*.test.js"
