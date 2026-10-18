// Text as the tracker compares and searches it, on the js target: the platform's Unicode
// normalization and collation, exactly as the JS version calls them.

///|
/// Lower case, without diacritics: `toLowerCase().normalize("NFD")` without `\p{Diacritic}`.
extern "js" fn fold(s : String) -> String =
  #|(s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")

///|
/// `a.localeCompare(b)`, as -1, 0 or 1.
extern "js" fn locale_compare(a : String, b : String) -> Int32 =
  #|(a, b) => Math.sign(a.localeCompare(b))
