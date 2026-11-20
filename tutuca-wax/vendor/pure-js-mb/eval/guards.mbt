// The runtime's guards on indexing, as the reference's lib/runtime.js: pure-js's
// one dynamic exclusion. x[k] reads an element of a list or a string by number,
// or an own key of an object by string; anything else is undefined behaviour,
// which aborts the run instead of doing what JavaScript would.

///|
using @value {type Value, type RunError}

///|
fn is_dictionary(v : Value) -> Bool {
  v is (Obj(_) | Handle(_) | Module(_))
}

///|
fn kind_word(v : Value) -> String {
  if v is List(_) {
    "list"
  } else {
    @value.type_of(v)
  }
}

///|
fn element(items : Array[Value], key : Double) -> Value {
  let i = key.to_int()
  if i.to_double() == key && i >= 0 && i < items.length() {
    items[i]
  } else {
    Undefined
  }
}

///|
pub fn index_get(object : Value, key : Value) -> Value raise RunError {
  match object {
    Undefined | Null =>
      raise @value.type_error(
        "Cannot read properties of \{@value.to_js_string(object)} (reading '\{@value.to_js_string(key)}')",
      )
    _ => ()
  }
  match key {
    Num(n) =>
      match object {
        List(l) => element(l.items, n)
        Str(s) => {
          let i = n.to_int()
          if i.to_double() == n && i >= 0 && i < s.length() {
            Str(s.exact_view(start=i, end=i + 1).to_owned())
          } else {
            Undefined
          }
        }
        _ =>
          raise UndefinedBehaviour(
            "indexing a \{@value.type_of(object)} by a number",
          )
      }
    Str(k) =>
      match object {
        Obj(o) => o.props.get(k).unwrap_or(Undefined)
        Handle(h) => h.fields.get(k).unwrap_or(Undefined)
        Module(_) => Undefined
        _ =>
          raise UndefinedBehaviour(
            "indexing a \{kind_word(object)} by a string",
          )
      }
    _ => raise UndefinedBehaviour("indexing by a \{@value.type_of(key)}")
  }
}

///|
pub fn index_set(object : Value, key : Value, v : Value) -> Unit raise RunError {
  match object {
    Undefined | Null =>
      raise @value.type_error(
        "Cannot set properties of \{@value.to_js_string(object)} (setting '\{@value.to_js_string(key)}')",
      )
    _ => ()
  }
  match key {
    Num(n) => {
      match object {
        List(l) => {
          let i = n.to_int()
          if i.to_double() == n && i >= 0 && i <= l.items.length() {
            if l.frozen {
              raise @value.type_error(
                "Cannot assign to read only property '\{i}' of object",
              )
            }
            if i == l.items.length() {
              l.items.push(v)
            } else {
              l.items[i] = v
            }
            return
          }
          raise UndefinedBehaviour(
            "setting element \{@value.number_text(n)} of a list of \{l.items.length()}",
          )
        }
        _ => ()
      }
      raise UndefinedBehaviour(
        "setting a \{@value.type_of(object)} by a number",
      )
    }
    Str(k) => {
      if @tables.is_reserved(k) {
        raise UndefinedBehaviour("setting the key \"\{k}\"")
      }
      match object {
        Obj(o) => {
          if o.frozen {
            raise @value.type_error(
              "Cannot assign to read only property '\{k}' of object",
            )
          }
          o.props[k] = v
        }
        _ =>
          if is_dictionary(object) {
            raise @value.type_error(
              "Cannot assign to read only property '\{k}' of object",
            )
          } else {
            raise UndefinedBehaviour(
              "setting a \{kind_word(object)} by a string",
            )
          }
      }
    }
    _ => raise UndefinedBehaviour("setting by a \{@value.type_of(key)}")
  }
}
