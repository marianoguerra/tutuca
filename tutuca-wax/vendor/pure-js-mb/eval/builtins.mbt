// The built-in methods, with JavaScript's semantics: a callback gets the
// element, its index and the list; a method reads the list's length when it
// starts, so a callback that pushes to the list it walks ends.

///|
fn call_cb(f : Value, args : Array[Value]) -> Value raise RunError {
  match f {
    Fn(cb) => (cb.call)(args)
    _ => raise @value.type_error("\{@value.to_js_string(f)} is not a function")
  }
}

///|
fn arg(args : Array[Value], i : Int32) -> Value {
  args.get(i).unwrap_or(Undefined)
}

///|
/// A relative index (slice, splice, at): negative counts from the end.
fn relative(v : Value, len : Int32, default : Int32) -> Int32 {
  if v is Undefined {
    return default
  }
  let n = @value.to_number(v)
  let n = if n != n { 0.0 } else { n.trunc() }
  if n < 0.0 {
    (len.to_double() + n).max(0.0).to_int()
  } else {
    n.min(len.to_double()).to_int()
  }
}

///|
fn not_extensible(l : @value.ListRef) -> Unit raise RunError {
  if l.frozen {
    raise @value.type_error(
      "Cannot add property \{l.items.length()}, object is not extensible",
    )
  }
}

///|
fn list_method(
  l : @value.ListRef,
  name : String,
  args : Array[Value],
) -> Value raise RunError {
  let items = l.items
  let len = items.length()
  let f = arg(args, 0)
  let at = (i : Int32) => Value::Num(i.to_double())
  let lv = Value::List(l)
  match name {
    "map" => {
      let out = []
      for i in 0..<len {
        if i < items.length() {
          out.push(call_cb(f, [items[i], at(i), lv]))
        }
      }
      @value.list(out)
    }
    "filter" => {
      let out = []
      for i in 0..<len {
        if i < items.length() {
          let x = items[i]
          if @value.truthy(call_cb(f, [x, at(i), lv])) {
            out.push(x)
          }
        }
      }
      @value.list(out)
    }
    "flatMap" => {
      let out = []
      for i in 0..<len {
        if i < items.length() {
          match call_cb(f, [items[i], at(i), lv]) {
            List(inner) => out.push_iter(inner.items.iter())
            v => out.push(v)
          }
        }
      }
      @value.list(out)
    }
    "find" | "findIndex" => {
      for i in 0..<len {
        let x = items.get(i).unwrap_or(Undefined)
        if @value.truthy(call_cb(f, [x, at(i), lv])) {
          return if name == "find" { x } else { at(i) }
        }
      }
      if name == "find" {
        Undefined
      } else {
        Num(-1.0)
      }
    }
    "findLast" | "findLastIndex" => {
      for k in 0..<len {
        let i = len - 1 - k
        let x = items.get(i).unwrap_or(Undefined)
        if @value.truthy(call_cb(f, [x, at(i), lv])) {
          return if name == "findLast" { x } else { at(i) }
        }
      }
      if name == "findLast" {
        Undefined
      } else {
        Num(-1.0)
      }
    }
    "some" => {
      for i in 0..<len {
        if i < items.length() &&
          @value.truthy(call_cb(f, [items[i], at(i), lv])) {
          return Bool(true)
        }
      }
      Bool(false)
    }
    "every" => {
      for i in 0..<len {
        if i < items.length() &&
          !@value.truthy(call_cb(f, [items[i], at(i), lv])) {
          return Bool(false)
        }
      }
      Bool(true)
    }
    "forEach" => {
      for i in 0..<len {
        if i < items.length() {
          ignore(call_cb(f, [items[i], at(i), lv]))
        }
      }
      Undefined
    }
    "reduce" => {
      if args.length() < 2 {
        if len == 0 {
          raise @value.type_error("Reduce of empty array with no initial value")
        }
      }
      let mut acc = if args.length() >= 2 { args[1] } else { items[0] }
      let from = if args.length() >= 2 { 0 } else { 1 }
      for i in from..<len {
        if i < items.length() {
          acc = call_cb(f, [acc, items[i], at(i), lv])
        }
      }
      acc
    }
    "includes" => Bool(items.iter().any(x => @value.same_value_zero(x, f)))
    "indexOf" => {
      for i, x in items {
        if @value.strict_equal(x, f) {
          return at(i)
        }
      }
      Num(-1.0)
    }
    "lastIndexOf" => {
      for k in 0..<len {
        let i = len - 1 - k
        if @value.strict_equal(items[i], f) {
          return at(i)
        }
      }
      Num(-1.0)
    }
    "slice" => {
      let start = relative(arg(args, 0), len, 0)
      let end = relative(arg(args, 1), len, len)
      @value.list(if start < end { items[start:end].to_owned() } else { [] })
    }
    "concat" => {
      let out = items.copy()
      for a in args {
        match a {
          List(other) => out.push_iter(other.items.iter())
          _ => out.push(a)
        }
      }
      @value.list(out)
    }
    "at" => {
      let n = @value.to_number(f)
      let n = if n != n { 0 } else { n.trunc().to_int() }
      let i = if n < 0 { len + n } else { n }
      items.get(i).unwrap_or(Undefined)
    }
    "join" => {
      let sep = match f {
        Undefined => ","
        _ => @value.to_js_string(f)
      }
      Str(
        items
        .map(x => {
          match x {
            Undefined | Null => ""
            _ => @value.to_js_string(x)
          }
        })
        .join(sep),
      )
    }
    "push" => {
      not_extensible(l)
      items.push_iter(args.iter())
      Num(items.length().to_double())
    }
    "unshift" => {
      not_extensible(l)
      let rest = items.copy()
      items.clear()
      items.push_iter(args.iter())
      items.push_iter(rest.iter())
      Num(items.length().to_double())
    }
    "pop" => {
      if l.frozen {
        raise @value.type_error(
          "Cannot delete property '\{len - 1}' of [object Array]",
        )
      }
      items.pop().unwrap_or(Undefined)
    }
    "shift" => {
      if l.frozen {
        raise @value.type_error(
          "Cannot delete property '\{len - 1}' of [object Array]",
        )
      }
      if len == 0 {
        Undefined
      } else {
        items.remove(0)
      }
    }
    "splice" => {
      if l.frozen {
        raise @value.type_error("Cannot add/remove sealed array elements")
      }
      let start = relative(arg(args, 0), len, 0)
      let count = if args.length() < 2 {
        len - start
      } else {
        let c = @value.to_number(args[1])
        let c = if c != c { 0.0 } else { c.trunc() }
        c.max(0.0).min((len - start).to_double()).to_int()
      }
      let removed = items[start:start + count].to_owned()
      let tail = items[start + count:].to_owned()
      while items.length() > start {
        ignore(items.pop())
      }
      for i in 2..<args.length() {
        items.push(args[i])
      }
      items.push_iter(tail.iter())
      @value.list(removed)
    }
    "sort" => {
      if l.frozen {
        raise @value.type_error(
          "Cannot assign to read only property '0' of object '[object Array]'",
        )
      }
      let sorted = merge_sort(items.copy(), f)
      for i, x in sorted {
        items[i] = x
      }
      lv
    }
    "reverse" => {
      if l.frozen {
        raise @value.type_error(
          "Cannot assign to read only property '0' of object '[object Array]'",
        )
      }
      items.rev_in_place()
      lv
    }
    _ => raise @value.type_error("\{name} is not a function")
  }
}

///|
/// A stable sort, as JavaScript's: compare's result above 0 puts b first;
/// without compare, by the elements' strings.
fn merge_sort(
  xs : Array[Value],
  compare : Value,
) -> Array[Value] raise RunError {
  if xs.length() <= 1 {
    return xs
  }
  let mid = xs.length() / 2
  let a = merge_sort(xs[:mid].to_owned(), compare)
  let b = merge_sort(xs[mid:].to_owned(), compare)
  let out = []
  let mut i = 0
  let mut j = 0
  while i < a.length() && j < b.length() {
    let order = match compare {
      Undefined => {
        let x = @value.to_js_string(a[i])
        let y = @value.to_js_string(b[j])
        x.compare(y).to_double()
      }
      _ => {
        let r = @value.to_number(call_cb(compare, [a[i], b[j]]))
        if r != r {
          0.0
        } else {
          r
        }
      }
    }
    if order > 0.0 {
      out.push(b[j])
      j += 1
    } else {
      out.push(a[i])
      i += 1
    }
  }
  out.push_iter(a[i:].iter())
  out.push_iter(b[j:].iter())
  out
}

///|
fn find_from(s : String, search : String, from : Int32) -> Int32 {
  if search.length() == 0 {
    return from.min(s.length())
  }
  for i in from..<=(s.length() - search.length()) {
    if s.exact_view(start=i, end=i + search.length()) == search {
      return i
    }
  }
  -1
}

///|
fn string_method(
  s : String,
  name : String,
  args : Array[Value],
) -> Value raise RunError {
  let len = s.length()
  let a0 = arg(args, 0)
  let text = (v : Value) => @value.to_js_string(v)
  match name {
    "trim" => Str(@value.js_trim(s))
    "trimStart" => Str(@value.js_trim(s, end=false))
    "trimEnd" => Str(@value.js_trim(s, start=false))
    "toLowerCase" => Str(s.to_lower())
    "toUpperCase" => Str(s.to_upper())
    "split" => {
      let sep = text(a0)
      if a0 is Undefined {
        return @value.list([Str(s)])
      }
      if sep == "" {
        return @value.list(
          (0)
          .until(len)
          .map(i => Value::Str(s.exact_view(start=i, end=i + 1).to_owned()))
          .collect(),
        )
      }
      @value.list(s.split(sep).map(p => Value::Str(p.to_owned())).collect())
    }
    "startsWith" => Bool(s.has_prefix(text(a0)))
    "endsWith" => Bool(s.has_suffix(text(a0)))
    "includes" => Bool(find_from(s, text(a0), 0) >= 0)
    "indexOf" => Num(find_from(s, text(a0), 0).to_double())
    "lastIndexOf" => {
      let search = text(a0)
      let mut found = -1
      let mut i = 0
      while i <= len - search.length() {
        let at = find_from(s, search, i)
        if at < 0 {
          break
        }
        found = at
        i = at + 1
      }
      Num(found.to_double())
    }
    "slice" => {
      let start = relative(a0, len, 0)
      let end = relative(arg(args, 1), len, len)
      Str(if start < end { s.exact_view(start~, end~).to_owned() } else { "" })
    }
    "at" => {
      let n = @value.to_number(a0)
      let n = if n != n { 0 } else { n.trunc().to_int() }
      let i = if n < 0 { len + n } else { n }
      if i >= 0 && i < len {
        Str(s.exact_view(start=i, end=i + 1).to_owned())
      } else {
        Undefined
      }
    }
    "replaceAll" => {
      let search = text(a0)
      let replacement = text(arg(args, 1))
      let positions = []
      if search == "" {
        for i in 0..<=len {
          positions.push(i)
        }
      } else {
        let mut i = 0
        while i <= len - search.length() {
          let at = find_from(s, search, i)
          if at < 0 {
            break
          }
          positions.push(at)
          i = at + search.length()
        }
      }
      let sb = StringBuilder()
      let mut last = 0
      for p in positions {
        sb.write_string(s.exact_view(start=last, end=p).to_owned())
        sb.write_string(substitute(replacement, s, p, search))
        last = p + search.length()
      }
      sb.write_string(s.exact_view(start=last).to_owned())
      Str(sb.to_string())
    }
    _ => raise @value.type_error("\{name} is not a function")
  }
}

///|
/// A replacement's $$, $&, $` and $', as GetSubstitution has them.
fn substitute(
  replacement : String,
  s : String,
  at : Int32,
  matched : String,
) -> String {
  if !replacement.contains("$") {
    return replacement
  }
  let sb = StringBuilder()
  let mut i = 0
  let n = replacement.length()
  while i < n {
    if replacement[i] == '$' && i + 1 < n {
      match replacement[i + 1] {
        '$' => {
          sb.write_char('$')
          i += 2
          continue
        }
        '&' => {
          sb.write_string(matched)
          i += 2
          continue
        }
        '`' => {
          sb.write_string(s.exact_view(end=at).to_owned())
          i += 2
          continue
        }
        '\'' => {
          sb.write_string(s.exact_view(start=at + matched.length()).to_owned())
          i += 2
          continue
        }
        _ => ()
      }
    }
    sb.write_string(replacement.exact_view(start=i, end=i + 1).to_owned())
    i += 1
  }
  sb.to_string()
}

///|
fn number_method(
  n : Double,
  name : String,
  args : Array[Value],
) -> Value raise RunError {
  match name {
    "toFixed" => {
      let d = @value.to_number(arg(args, 0))
      let digits = if d != d { 0 } else { d.trunc().to_int() }
      if digits < 0 || digits > 100 {
        raise Thrown(
          kind="RangeError",
          message="toFixed() digits argument must be between 0 and 100",
        )
      }
      Str(to_fixed(n, digits))
    }
    _ => raise @value.type_error("\{name} is not a function")
  }
}

///|
/// Number.prototype.toFixed: the double's exact value rounded half up to f
/// digits, computed with integers so no rounding error creeps in.
pub fn to_fixed(x : Double, f : Int32) -> String {
  if x != x {
    return "NaN"
  }
  if x.abs() >= 1.0e21 {
    return @value.number_text(x)
  }
  let sign = if x < 0.0 { "-" } else { "" }
  let bits = x.abs().reinterpret_as_uint64()
  let exp = ((bits >> 52) & 0x7ffUL).to_int()
  let frac = bits & 0xfffffffffffffUL
  let (m, e) = if exp == 0 {
    (@bigint.BigInt::from_uint64(frac), -1074)
  } else {
    (@bigint.BigInt::from_uint64(frac | 0x10000000000000UL), exp - 1075)
  }
  let ten = @bigint.BigInt::from_int(10)
  let two = @bigint.BigInt::from_int(2)
  let scaled = m * ten.pow(@bigint.BigInt::from_int(f))
  let n = if e >= 0 {
    scaled * two.pow(@bigint.BigInt::from_int(e))
  } else {
    let denom = two.pow(@bigint.BigInt::from_int(-e))
    (scaled * two + denom) / (denom * two)
  }
  let digits = n.to_string()
  if f == 0 {
    return sign + digits
  }
  let padded = if digits.length() <= f {
    "0".repeat(f + 1 - digits.length()) + digits
  } else {
    digits
  }
  let cut = padded.length() - f
  "\{sign}\{padded.exact_view(end=cut)}.\{padded.exact_view(start=cut)}"
}
