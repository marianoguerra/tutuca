# Glob syntax (picomatch)

| glob | matches |
|---|---|
| `*` | any characters in one path segment (not `/`), not a leading `.` unless `dot` |
| `?` | one character, not `/` |
| `**` | any number of segments, zero included, when it is a whole segment (`a/**/b`, `**/*.js`) |
| `[abc]`, `[a-z]`, `[!a]` | one character from / not from a set |
| `{a,b}`, `{1..3}` | alternatives, ranges (braces expand) |
| `!(x)`, `?(x)`, `*(x)`, `+(x)`, `@(x)` | extglobs: not, zero or one, zero or more, one or more, exactly one |
| `!pattern` | a leading `!` negates the whole glob |
| `\*` | a literal `*` |

Notes:
- The glob matches the whole path: `*.js` matches `a.js` but not `src/a.js`; use `**/*.js`.
- `src/**` matches everything under `src/` (but not `src` itself without a trailing part).
- Dotfiles and dot-directories (`.env`, `.github/…`) are skipped by `*` and `**` unless the
  glob names the dot (`.github/**`) or the `dot` option is on.
- `nocase` makes letters match either case: `**/*.md` with nocase matches `Guide.MD`.
- To exclude, either negate a whole glob (`!**/*.test.js`) or use an extglob in a segment
  (`src/**/!(*.test).js`).
