// Calendar dates as ISO strings (YYYY-MM-DD), by day number, so no time zone shifts a day.

///|
let weekdays : Array[String] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
]

///|
let months : Array[String] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

///|
/// Days since 1970-01-01 of a civil date (Howard Hinnant's days_from_civil).
fn days_from_civil(y : Int32, m : Int32, d : Int32) -> Int32 {
  let y = if m <= 2 { y - 1 } else { y }
  let era = (if y >= 0 { y } else { y - 399 }) / 400
  let yoe = y - era * 400
  let mp = (m + 9) % 12
  let doy = (153 * mp + 2) / 5 + d - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  era * 146097 + doe - 719468
}

///|
fn civil_from_days(z : Int32) -> (Int32, Int32, Int32) {
  let z = z + 719468
  let era = (if z >= 0 { z } else { z - 146096 }) / 146097
  let doe = z - era * 146097
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp = (5 * doy + 2) / 153
  let d = doy - (153 * mp + 2) / 5 + 1
  let m = if mp < 10 { mp + 3 } else { mp - 9 }
  let y = yoe + era * 400 + (if m <= 2 { 1 } else { 0 })
  (y, m, d)
}

///|
fn pad2(n : Int32) -> String {
  n.to_string().pad_start(2, '0')
}

///|
fn day_to_iso(z : Int32) -> String {
  let (y, m, d) = civil_from_days(z)
  "\{y.to_string().pad_start(4, '0')}-\{pad2(m)}-\{pad2(d)}"
}

///|
fn digits(s : StringView) -> Int32? {
  if s.length() == 0 || !s.iter().all(c => c >= '0' && c <= '9') {
    return None
  }
  Some(@string.parse_int(s)) catch {
    _ => None
  }
}

///|
/// The day number of an ISO date, or None when it isn't one.
fn iso_day(iso : String) -> Int32? {
  guard iso.length() == 10 &&
    iso.get_char(4) == Some('-') &&
    iso.get_char(7) == Some('-') else {
    return None
  }
  guard digits(iso.view(end_offset=4)) is Some(y) &&
    digits(iso.view(start_offset=5, end_offset=7)) is Some(m) &&
    digits(iso.view(start_offset=8)) is Some(d) else {
    return None
  }
  let z = days_from_civil(y, m, d)
  if day_to_iso(z) == iso {
    Some(z)
  } else {
    None
  }
}

///|
pub fn is_iso(s : String) -> Bool {
  iso_day(s) is Some(_)
}

///|
pub fn add_days(iso : String, n : Int32) -> String {
  match iso_day(iso) {
    Some(z) => day_to_iso(z + n)
    None => iso
  }
}

///|
fn days_between(from : String, to : String) -> Int32 {
  iso_day(to).unwrap_or(0) - iso_day(from).unwrap_or(0)
}

///|
fn weekday_of(iso : String) -> Int32 {
  // 1970-01-01 was a Thursday.
  let z = iso_day(iso).unwrap_or(0)
  ((z % 7 + 7) % 7 + 4) % 7
}

///|
fn capitalize(s : String) -> String {
  match s.get_char(0) {
    Some(c) => c.to_string().to_upper() + s.view(start_offset=1).to_owned()
    None => s
  }
}

///|
fn month_day(iso : String) -> (String, Int32) {
  let (_, m, d) = civil_from_days(iso_day(iso).unwrap_or(0))
  (months[m - 1], d)
}

///|
/// "Today", "Tomorrow", "Yesterday", a weekday within the week, else "Oct 17" (with the year
/// when it isn't today's).
pub fn due_label(due : String, today : String) -> String {
  if !is_iso(due) || !is_iso(today) {
    return due
  }
  let n = days_between(today, due)
  if n == 0 {
    return "Today"
  }
  if n == 1 {
    return "Tomorrow"
  }
  if n == -1 {
    return "Yesterday"
  }
  if n > 1 && n < 7 {
    return capitalize(weekdays[weekday_of(due)])
  }
  let (month, day) = month_day(due)
  let label = "\{month} \{day}"
  if due.view(end_offset=4).to_owned() == today.view(end_offset=4).to_owned() {
    label
  } else {
    "\{label} \{due.view(end_offset=4).to_owned()}"
  }
}

///|
pub(all) enum Tone {
  Overdue
  DueToday
  Tomorrow
  Week
  Later
  NoTone
}

///|
/// How urgent a due date is, for its color.
pub fn due_tone(due : String, today : String) -> Tone {
  if !is_iso(due) || !is_iso(today) {
    return NoTone
  }
  let n = days_between(today, due)
  if n < 0 {
    Overdue
  } else if n == 0 {
    DueToday
  } else if n == 1 {
    Tomorrow
  } else if n < 7 {
    Week
  } else {
    Later
  }
}

///|
/// A day header for the upcoming view: "Fri 17 Oct · Today".
pub fn day_header(due : String, today : String) -> String {
  let (month, day) = month_day(due)
  let head = "\{capitalize(weekdays[weekday_of(due)]).view(end_offset=3).to_owned()} \{day} \{month}"
  let relative = due_label(due, today)
  // Relative labels that are just a date ("Oct 17") add nothing.
  let is_date = relative.length() > 4 &&
    months.contains(relative.view(end_offset=3).to_owned()) &&
    relative.get_char(3) == Some(' ')
  if is_date {
    head
  } else {
    "\{head} · \{relative}"
  }
}

///|
/// The date a run of words starting at words[i] names, with the number of words it took.
/// Understands today/tod, tomorrow/tom, yesterday, weekday names and their first three
/// letters (the next one, today included), "next week" (next Monday), "in N days", "in N
/// weeks" and ISO dates.
pub fn parse_due_words(
  words : Array[String],
  i : Int32,
  today : String,
) -> (String, Int32)? {
  guard words.get(i) is Some(w) else { return None }
  let w = w.to_lower()
  if w == "today" || w == "tod" {
    return Some((today, 1))
  }
  if w == "tomorrow" || w == "tom" {
    return Some((add_days(today, 1), 1))
  }
  if w == "yesterday" {
    return Some((add_days(today, -1), 1))
  }
  if is_iso(w) {
    return Some((w, 1))
  }
  for day, name in weekdays {
    if name == w || name.view(end_offset=3).to_owned() == w {
      return Some((add_days(today, (day - weekday_of(today) + 7) % 7), 1))
    }
  }
  let next = words.get(i + 1).map(s => s.to_lower())
  if w == "next" && next == Some("week") {
    let n = (1 - weekday_of(today) + 7) % 7
    return Some((add_days(today, if n == 0 { 7 } else { n }), 2))
  }
  let unit = words.get(i + 2).map(s => s.to_lower())
  if w == "in" && next.bind(n => digits(n)) is Some(n) {
    match unit {
      Some("day" | "days") => return Some((add_days(today, n), 3))
      Some("week" | "weeks") => return Some((add_days(today, n * 7), 3))
      _ => ()
    }
  }
  None
}
