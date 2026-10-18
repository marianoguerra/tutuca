// The CSS selectors event steps find their element by, as JS's `querySelector`: tags, `#id`,
// `.class`, `[attr]`, `[attr="v"]` (also `^=`, `*=`, `$=`, `~=`), `:nth-of-type(n)` and the
// descendant combinator, the subset the stories use.

///|
priv struct AttrTest {
  name : String
  op : String // "", "=", "^=", "*=", "$=", "~="
  value : String
}

///|
priv struct Compound {
  tag : String // "" for any.
  id : String?
  classes : Array[String]
  attrs : Array[AttrTest]
  nth_of_type : Int32? // 1-based.
}

///|
/// The compounds of `selector`, outermost first; raises on what it doesn't read.
fn parse_selector(selector : String) -> Array[Compound] raise {
  let chars = selector.to_array()
  let out = []
  let mut i = 0
  let n = chars.length()
  let name_char = (c : Char) => {
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c == '-' ||
    c == '_'
  }
  let read_name = () => {
    let start = i
    while i < n && name_char(chars[i]) {
      i += 1
    }
    String::from_array(chars[start:i])
  }
  while i < n {
    while i < n && chars[i] == ' ' {
      i += 1
    }
    if i >= n {
      break
    }
    let mut tag = ""
    let mut id = None
    let classes = []
    let attrs = []
    let mut nth = None
    if chars[i] == '*' {
      i += 1
    } else if name_char(chars[i]) {
      tag = read_name().to_upper()
    }
    while i < n && chars[i] != ' ' {
      match chars[i] {
        '.' => {
          i += 1
          classes.push(read_name())
        }
        '#' => {
          i += 1
          id = Some(read_name())
        }
        '[' => {
          i += 1
          let name = read_name()
          let mut op = ""
          let mut value = ""
          if i < n && chars[i] != ']' {
            let start = i
            while i < n && chars[i] != '=' {
              i += 1
            }
            op = String::from_array(chars[start:i + 1])
            i += 1
            if i < n && (chars[i] == '"' || chars[i] == '\'') {
              let quote = chars[i]
              i += 1
              let vstart = i
              while i < n && chars[i] != quote {
                i += 1
              }
              value = String::from_array(chars[vstart:i])
              i += 1
            } else {
              let vstart = i
              while i < n && chars[i] != ']' {
                i += 1
              }
              value = String::from_array(chars[vstart:i])
            }
          }
          guard i < n && chars[i] == ']' else { fail("no ] in \{selector}") }
          i += 1
          attrs.push({ name, op, value, })
        }
        ':' => {
          i += 1
          let pseudo = read_name()
          guard pseudo == "nth-of-type" && i < n && chars[i] == '(' else {
            fail("only :nth-of-type(n) is read, in \{selector}")
          }
          i += 1
          let start = i
          while i < n && chars[i] != ')' {
            i += 1
          }
          nth = Some(@string.parse_int(String::from_array(chars[start:i])))
          i += 1
        }
        c => fail("unexpected \{c} in \{selector}")
      }
    }
    out.push({ tag, id, classes, attrs, nth_of_type: nth, })
  }
  out
}

///|
fn[N : @vdom.DomNode] Compound::matches(self : Compound, el : N) -> Bool {
  if el.tag_name() == "" {
    return false
  }
  if self.tag != "" && el.tag_name().to_upper() != self.tag {
    return false
  }
  if self.id is Some(id) && el.get_attribute("id") != Some(id) {
    return false
  }
  let classes = el
    .get_attribute("class")
    .unwrap_or("")
    .split(" ")
    .map(c => c.to_owned())
    .collect()
  if !self.classes.iter().all(c => classes.contains(c)) {
    return false
  }
  for a in self.attrs {
    let ok = match el.get_attribute(a.name) {
      None => false
      Some(v) =>
        match a.op {
          "" => true
          "=" => v == a.value
          "^=" => a.value != "" && v.has_prefix(a.value)
          "*=" => a.value != "" && v.contains(a.value)
          "$=" => a.value != "" && v.has_suffix(a.value)
          "~=" => v.split(" ").any(w => w == a.value)
          _ => false
        }
    }
    if !ok {
      return false
    }
  }
  match self.nth_of_type {
    Some(k) =>
      match el.parent_node() {
        Some(p) => {
          let same = p
            .child_nodes()
            .filter(c => c.tag_name() != "" && c.tag_name() == el.tag_name())
          same.search_by(c => c.is_same_node(el)) == Some(k - 1)
        }
        None => k == 1
      }
    None => true
  }
}

///|
/// Whether `el` matches the compounds, the last one itself and the others ancestors in order.
fn[N : @vdom.DomNode] selector_matches(
  compounds : Array[Compound],
  el : N,
) -> Bool {
  guard compounds.last() is Some(last) && last.matches(el) else { return false }
  let mut k = compounds.length() - 2
  let mut at = el.parent_node()
  while k >= 0 {
    match at {
      Some(a) => {
        if compounds[k].matches(a) {
          k -= 1
        }
        at = a.parent_node()
      }
      None => return false
    }
  }
  true
}

///|
/// The first element under `root`, in document order, that `selector` matches.
fn[N : @vdom.DomNode] query_selector(root : N, selector : String) -> N? raise {
  let compounds = parse_selector(selector)
  fn walk(n : N) -> N? {
    for c in n.child_nodes() {
      if selector_matches(compounds, c) {
        return Some(c)
      }
      if walk(c) is Some(found) {
        return Some(found)
      }
    }
    None
  }

  walk(root)
}
