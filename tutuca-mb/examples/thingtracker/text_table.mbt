// Text as the tracker compares and searches it, off the js target: accents stripped with a
// table of Latin letters and the combining marks, and an order that approximates ICU's.
// text_js.mbt uses the platform's own on js, as the JS version does.

///|
/// Accented Latin letters NFD decomposes, by their base letter.
let accents : Array[(String, Char)] = [
  ("àáâãäåāăąǎ", 'a'),
  ("çćĉċč", 'c'),
  ("ď", 'd'),
  ("èéêëēĕėęě", 'e'),
  ("ĝğġģ", 'g'),
  ("ĥ", 'h'),
  ("ìíîïĩīĭįǐ", 'i'),
  ("ĵ", 'j'),
  ("ķ", 'k'),
  ("ĺļľ", 'l'),
  ("ñńņň", 'n'),
  ("òóôõöōŏőǒ", 'o'),
  ("ŕŗř", 'r'),
  ("śŝşš", 's'),
  ("ţť", 't'),
  ("ùúûüũūŭůűųǔ", 'u'),
  ("ŵ", 'w'),
  ("ýÿŷ", 'y'),
  ("źżž", 'z'),
]

///|
/// Lower case, without diacritics.
fn fold(s : String) -> String {
  let sb = StringBuilder()
  for c in s.to_lower() {
    let code = c.to_int()
    if (code >= 0x300 && code <= 0x36f) ||
      c is ('^' | '`' | '¨' | '¯' | '´' | '¸' | '·') {
      continue
    }
    let lower = if c >= 'À' && c <= 'Þ' && c != '×' {
      Int32::unsafe_to_char(code + 32)
    } else {
      c
    }
    match accents.iter().find_first(a => a.0.contains_char(lower)) {
      Some((_, base)) => sb.write_char(base)
      None => sb.write_char(lower)
    }
  }
  sb.to_string()
}

///|
/// A comparison close to JS's localeCompare: case and accents matter only to break ties.
fn locale_compare(a : String, b : String) -> Int32 {
  let c = fold(a).lexical_compare(fold(b))
  if c != 0 {
    return c
  }
  let l = a.to_lower().lexical_compare(b.to_lower())
  if l != 0 {
    return l
  }
  // Lower case first, as ICU orders a and A.
  b.lexical_compare(a)
}
