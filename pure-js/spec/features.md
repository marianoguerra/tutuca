# Features

Generated from `lib/tables.js` by `node tools/spec-tables.js`: what the sieve admits, leaves for
a later version, and excludes by design. A diagnostic's code is the feature's name.

## In the core profile

| Feature | What | |
|---|---|---|
| `function-program` | a function expression |  |
| `method-program` | a method, as String(fn) prints one |  |
| `getter-program` | a getter, as String(fn) prints one |  |
| `arrow-program` | an arrow function |  |
| `const-declaration` | const declarations |  |
| `expression-statement` | expression statements |  |
| `if-statement` | if and else |  |
| `block-statement` | blocks |  |
| `return-statement` | return |  |
| `identifier` | names |  |
| `string-literal` | strings |  |
| `number-literal` | numbers |  |
| `boolean-literal` | true and false |  |
| `null-literal` | null |  |
| `template-literal` | template literals |  |
| `member` | property access |  |
| `computed-member` | indexing |  |
| `optional-member` | optional chaining |  |
| `call` | calls |  |
| `this` | this |  |
| `array-literal` | array literals |  |
| `object-literal` | object literals |  |
| `spread` | spread |  |
| `conditional` | the conditional operator |  |
| `logical` | &&, || and ?? |  |
| `not` | ! |  |
| `negate` | unary minus |  |
| `typeof` | typeof |  |
| `strict-equality` | === and !== |  |
| `comparison` | <, >, <= and >= |  |
| `arithmetic` | +, -, *, / and % |  |
| `assignment` | assignment |  |
| `add-assignment` | += and -= |  |
| `callback-arrow` | arrow functions as the callback of a list method (map, filter, sort, ...) |  |
| `array-pattern-param` | array patterns of names as parameters |  |
| `type-annotation` | type annotations |  |

## Omitted from this version

Exit status 2. The last column names the profile that will admit it, when one is planned.

| Feature | What | Profile |
|---|---|---|
| `module-program` | modules: types, data, helper functions and namespaces | module |
| `import-declaration` | import declarations | module |
| `export-declaration` | export declarations | module |
| `helper-function` | functions declared in a module, which code may call | module |
| `type-alias` | type aliases | module |
| `interface-declaration` | interfaces | module |
| `namespace-method` | methods and getters in a module's namespaces, which the embedder calls | module |
| `this-parameter` | a this parameter, saying what this is | module |
| `let-declaration` | let declarations | let |
| `let-assignment` | assigning to a let | let |
| `multiple-declarators` | several declarations in one const | destructuring |
| `destructuring-declaration` | destructuring in const | destructuring |
| `for-of-statement` | for-of loops | forOf |
| `loop-control` | break and continue | forOf |
| `try-statement` | try and catch | tryCatch |
| `switch-statement` | switch |  |
| `compound-assignment` | compound assignments other than += and -= |  |
| `computed-compound-assignment` | += and -= on an indexed place |  |
| `update` | ++ and -- |  |
| `bitwise` | bitwise operators |  |
| `optional-call` | optional calls, f?.() |  |
| `optional-computed-member` | indexing in an optional chain, x?.[k] or x?.y[k] |  |
| `computed-key` | computed keys in object literals |  |
| `numeric-key` | numeric keys in object literals |  |
| `block-arrow` | arrow functions with a block body | module |
| `object-pattern` | object patterns | destructuring |
| `default-value` | default values | destructuring |
| `rest-element` | rest elements | destructuring |
| `nested-pattern` | nested patterns | destructuring |
| `destructuring-assignment` | destructuring assignment |  |
| `function-type` | function types in annotations |  |
| `generic-type` | generic types such as Array<T>; write T[] |  |
| `readonly-type` | readonly and Readonly<T> in annotations; mutability comes from the signature | module |
| `method-type` | method signatures in annotations; a module's interfaces have them | module |
| `type-keyword` | this type keyword |  |
| `arrow-return-type` | return types on callbacks; the call says what they return |  |
| `optional-parameter` | optional parameters |  |

## Excluded by design

Exit status 1. No profile admits these.

| Feature | What | Why |
|---|---|---|
| `module-statement` | statements in a module outside a function | a module only declares: running it does nothing but make its constants |
| `module-let` | let in a module | what a module declares is constant |
| `default-export` | export default and export lists | an export is a declaration |
| `namespace-import` | import * and side-effect imports | an import names what it takes |
| `recursive-call` | functions that call themselves, directly or through others | a program must terminate: the calls between a module's functions can't form a cycle |
| `var-declaration` | var declarations | var is function-scoped and hoisted |
| `loop-statement` | while, do-while and C-style for loops | a program must terminate: it can only iterate through the methods of lists |
| `for-in-statement` | for-in loops | it walks inherited properties |
| `throw-statement` | throw | errors are not values in pure-js; only hosts abort a run |
| `labeled-statement` | labels | there are no loops to break out of |
| `empty-statement` | empty statements | a lone semicolon does nothing |
| `function-declaration` | nested functions | a program is one function; a callback is an arrow passed to a call |
| `class-declaration` | classes | values are plain data |
| `with-statement` | with | it changes what names mean at run time |
| `debugger-statement` | debugger | it reaches outside the program |
| `module-syntax` | import and export | a program can only use what its host provides |
| `useless-expression` | expression statements that are not a call or an assignment | they compute a value and drop it |
| `line-break-after-return` | a line break between return and its value | JavaScript would return undefined there |
| `missing-semicolon` | statements without a semicolon | semicolons are required, so no statement depends on where lines break |
| `loose-equality` | == and != | they convert their operands |
| `exponent` | ** | its result is implementation-approximated |
| `in-operator` | in | it sees inherited properties |
| `instanceof` | instanceof | values have no classes |
| `unary-plus` | unary + | it converts its operand |
| `void` | void | it computes a value and drops it |
| `delete` | delete | a field is set, not removed |
| `sequence` | the comma operator | it drops values |
| `assignment-expression` | assignments used as expressions | an assignment is a statement |
| `reassignment` | assigning to a name | a name is bound once |
| `arrow-not-callback` | arrow functions other than as the callback of a list method | functions are not values, so nothing can recurse or be called after the program ends |
| `function-expression` | nested function expressions | a callback is an arrow passed to a call |
| `array-hole` | holes in array literals | arrays are dense |
| `object-method` | methods, getters and setters in object literals | records are data |
| `new` | new | values are plain data, made by literals and host functions |
| `class` | classes | values are plain data |
| `tagged-template` | tagged templates | a tag is a function value |
| `regex` | regular expressions | matching is left to hosts |
| `bigint` | BigInt literals | numbers are doubles |
| `legacy-octal` | legacy octal literals and escapes | strict mode has none |
| `async` | async functions and await | a run is one synchronous call |
| `generator` | generators and yield | a run is one synchronous call |
| `super` | super | values have no classes |
| `private-name` | private names | values have no classes |
| `decorator` | decorators | they are function values |
| `dynamic-import` | import() | a program can only use what its host provides |
| `meta-property` | new.target and import.meta | they reach outside the program |
| `identifier-escape` | escapes and non-ASCII letters in names | a name is spelled one way |
| `dollar-name` | names that start with $ | they are the compiler's |
| `reserved-name` | properties that reach the machinery of JavaScript objects | no value has them in pure-js |
| `any-type` | any | it turns checking off |
| `type-assertion` | type assertions (as, satisfies, !) | they turn checking off |

## Reserved names

No property, key or host member may have these names:

`constructor`, `prototype`, `__proto__`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toString`, `toLocaleString`, `valueOf`, `caller`, `callee`, `arguments`

`call`, `apply` and `bind` only name members of host modules.

## Built-in methods

`T` is the type of a list's elements.

| Receiver | Method | Signature | |
|---|---|---|---|
| list | `map` | `<U>(f: (value: T, index: number) => U) => U[]` | returns a fresh list |
| list | `filter` | `(f: (value: T, index: number) => boolean) => T[]` | returns a fresh list |
| list | `flatMap` | `<U>(f: (value: T, index: number) => U[]) => U[]` | returns a fresh list |
| list | `find` | `(f: (value: T, index: number) => boolean) => T | undefined` |  |
| list | `findLast` | `(f: (value: T, index: number) => boolean) => T | undefined` |  |
| list | `findIndex` | `(f: (value: T, index: number) => boolean) => number` |  |
| list | `findLastIndex` | `(f: (value: T, index: number) => boolean) => number` |  |
| list | `some` | `(f: (value: T, index: number) => boolean) => boolean` |  |
| list | `every` | `(f: (value: T, index: number) => boolean) => boolean` |  |
| list | `forEach` | `(f: (value: T, index: number) => unknown) => void` |  |
| list | `reduce` | `<U>(f: (acc: U, value: T, index: number) => U, initial: U) => U` |  |
| list | `includes` | `(value: T) => boolean` |  |
| list | `indexOf` | `(value: T) => number` |  |
| list | `lastIndexOf` | `(value: T) => number` |  |
| list | `slice` | `(start?: number, end?: number) => T[]` | returns a fresh list |
| list | `concat` | `(...lists: T[][]) => T[]` | returns a fresh list |
| list | `at` | `(index: number) => T | undefined` |  |
| list | `join` | `(separator: string) => string` | elements must be primitive |
| list | `push` | `(...items: T[]) => number` | changes its receiver |
| list | `unshift` | `(...items: T[]) => number` | changes its receiver |
| list | `pop` | `() => T | undefined` | changes its receiver |
| list | `shift` | `() => T | undefined` | changes its receiver |
| list | `splice` | `(start: number, count: number, ...items: T[]) => T[]` | changes its receiver; returns a fresh list |
| list | `sort` | `(compare: (a: T, b: T) => number) => T[]` | changes its receiver; returns its receiver |
| list | `reverse` | `() => T[]` | changes its receiver; returns its receiver |
| string | `trim` | `() => string` |  |
| string | `trimStart` | `() => string` |  |
| string | `trimEnd` | `() => string` |  |
| string | `toLowerCase` | `() => string` |  |
| string | `toUpperCase` | `() => string` |  |
| string | `split` | `(separator: string) => string[]` | returns a fresh list |
| string | `startsWith` | `(search: string) => boolean` |  |
| string | `endsWith` | `(search: string) => boolean` |  |
| string | `includes` | `(search: string) => boolean` |  |
| string | `indexOf` | `(search: string) => number` |  |
| string | `lastIndexOf` | `(search: string) => number` |  |
| string | `slice` | `(start?: number, end?: number) => string` |  |
| string | `at` | `(index: number) => string | undefined` |  |
| string | `replaceAll` | `(search: string, replacement: string) => string` |  |
| number | `toFixed` | `(digits: number) => string` |  |
