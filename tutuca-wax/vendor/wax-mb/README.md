# Vendored from wax-mb

`persistent_hash_map.wax` and `persistent_vector.wax` are wax-mb's
`stdlib/collections`, copied unmodified with its `tools/vendor-collections.sh`
(`map`, `vector`) from commit `bf4f43721682e0b60123baa58b6953b27fe63f44`
(https://github.com/marianoguerra/wax-mb), under the Apache License 2.0
(`LICENSE`, `NOTICE`).

They stay byte for byte as upstream ships them, so wax-mb's own tests of them
(QuickCheck state-machine traces against MoonBit's `HashMap` and `Array`,
structural-sharing and boundary checks) still describe the code that runs
here, and updating is copying them again. The adaptation to tutuca's runtime
is `src/collections.wax`: the `List` and `Map` of the `Value` type, with
values typed `&value` instead of `&?eq` and the map's key policy fixed to
JS-string keys.

`hashing.wax` isn't vendored: map keys are JS strings, hashed with the
runtime's own `str_hash` (FNV-1a over the UTF-16 code units, `src/str.wax`).

To update: `npm run setup` with the new commit in `scripts/setup-wax-mb.sh`,
then

```sh
.tools/wax-mb/tools/vendor-collections.sh vendor/wax-mb map
.tools/wax-mb/tools/vendor-collections.sh vendor/wax-mb vector
```

and record the commit here.
