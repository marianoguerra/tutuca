# Syntax

The lexical syntax is JavaScript's, smaller: names are ASCII (`[A-Za-z_$][A-Za-z0-9_$]*`,
without escapes), there are no regular expressions (`/` is always division), no BigInt and no
legacy octal. Names that start with `$` are the compiler's.

## Programs

A program is one function, in one of the forms `String(fn)` prints a function as:

```
program    := function | method | getter | arrow
function   := "function" name? "(" params ")" returnType? body
method     := name "(" params ")" returnType? body
getter     := "get" name "(" ")" returnType? body
arrow      := (name | "(" params ")" returnType?) "=>" (expression | body)
params     := (param ("," param)*)? ","?
param      := name annotation? | "[" (name? ("," name?)*)? "]" annotation?
returnType := ":" type
annotation := ":" type
```

An arrow program has no `this`.

## Modules (the module profile)

A module is a program of declarations: what it imports, its types, its constants, its helper
functions and its namespaces, each maybe exported.

```
module      := item*
item        := import | "export"? declaration
import      := "import" "type"? "{" spec ("," spec)* ","? "}" "from" string ";"
spec        := name ("as" name)?
declaration := "const" name annotation? "=" expression ";"
             | "function" name "(" thisParam? params ")" returnType? body
             | "type" Name "=" type ";"
             | "interface" Name "{" member* "}"
thisParam   := "this" annotation ","?
```

A constant whose value is an object literal holding methods or getters (itself, or in the
object literals it holds) is a **namespace**: its methods and getters are its **entries**, the
functions the embedder calls, by path (`Counter.on.add.run`), with a signature it gives for
each. Methods and getters are written as JavaScript writes them, and only there:

```
member      := name "(" thisParam? params ")" returnType? body          a method
             | "get" name "(" ")" returnType? body                      a getter
```

`import { f } from "./other"` takes what another module exports; `import { div } from
"app/view"` takes members of a module the host offers by that specifier; `import type` takes
types. There is no `export default`, no export lists, no `import *` and no side-effect import:
an import names what it takes, an export is a declaration. A module doesn't run statements: a
statement outside a function is rejected, and so is `let` (what a module declares is constant).

The module profile also admits what the let, destructuring and forOf profiles do:

```
statement  += "let" pattern annotation? "=" expression ";"
            | name ("=" | "+=" | "-=") expression ";"           name a let
            | "for" "(" "const" pattern "of" expression ")" statement
            | "break" ";" | "continue" ";"                         in a for-of
pattern    := name | "[" (element ("," element)*)? "]" | "{" (prop ("," prop)*)? "}"
element    := pattern ("=" expression)? | "..." name
prop       := name ("=" expression)? | name ":" pattern ("=" expression)? | "..." name
```

and arrows with a block body (still only as a list method's callback), whose `return` returns
from the callback.

## Statements

```
body       := "{" statement* "}"
statement  := "const" name annotation? "=" expression ";"
            | expression ";"                          a call or an assignment
            | target ("=" | "+=" | "-=") expression ";"
            | "if" "(" expression ")" statement ("else" statement)?
            | body
            | "return" expression? ";"
target     := expression "." name | expression "[" expression "]"
```

Semicolons are required: a statement never depends on where a line breaks, and a line break
between `return` and its value is rejected (JavaScript would return `undefined`). A `const`
can't be a single statement (`if (x) const y = 1;` is not JavaScript either), and a name is
declared once in a block.

## Expressions

```
expression := assignment-free conditional
conditional:= logical ("?" expression ":" expression)?
logical    := binary (("&&" | "||" | "??") binary)*      ?? is not mixed with && and ||
binary     := unary (op unary)*      op: === !== < > <= >= + - * / %
unary      := ("!" | "-" | "typeof") unary | postfix
postfix    := primary (("." | "?.") name | "[" expression "]" | arguments)*
arguments  := "(" (argument ("," argument)*)? ","? ")"
argument   := expression | "..." expression | callback
callback   := (name | "(" params ")") "=>" expression
primary    := name | "this" | literal | template | array | object | "(" expression ")"
literal    := string | number | "true" | "false" | "null"
array      := "[" (element ("," element)*)? ","? "]"      element: expression | "..." expression
object     := "{" (property ("," property)*)? ","? "}"
property   := (name | string) ":" expression | name | "..." expression
```

Precedence and associativity are JavaScript's. A callback is an arrow with an expression body,
and only ever a call's argument: functions are not values, so nothing can recurse. Indexing
(`x[k]`) is not allowed inside an optional chain in this version.

## Annotations

In a module, `Readonly<T>` and `readonly T[]` say that a parameter (or this) isn't changed,
and an interface's members may be method signatures (what a host's values have).


TypeScript's, where erasing them leaves JavaScript: on parameters, on `const`, on the program's
return.

```
type       := union
union      := "|"? array ("|" array)*
array      := primary ("[" "]")*
primary    := "number" | "string" | "boolean" | "null" | "undefined" | "unknown" | "void"
            | string | number | "true" | "false"            literal types
            | Name                                          a type the host declares
            | "(" type ")"
            | "[" type ("," type)* "]"                      a tuple
            | "{" (name "?"? ":" type ";")* "}"             a record
            | "{" "[" name ":" "string" "]" ":" type "}"    a dictionary
```

Hosts declare with the same grammar plus function types (`<U>(f: (x: T) => U) => U[]`),
methods (`name(a: T): R`), rest and optional parameters, and `readonly` fields; programs can't
write those in this version. `any`, casts (`as`, `satisfies`, `!`), generics and the rest of
TypeScript's type language are left out ([Features](features.md)).
