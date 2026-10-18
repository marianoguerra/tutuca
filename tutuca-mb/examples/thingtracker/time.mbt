// Time helpers of thing-tracker (src/lib/time.ts), from time.js. Timestamps are epoch ms as
// Doubles, as in JS; tz is the offset of local time from UTC in minutes, passed in so results
// don't depend on the machine running them.

///|
pub let minute : Double = 60000.0

///|
pub let hour : Double = 3600000.0

///|
pub let day : Double = 86400000.0

///|
let weekdays : Array[String] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

///|
let months : Array[String] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

///|
let long_months : Array[String] = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December",
]

///|
/// The insights granularity.
pub(all) enum Granularity {
  Day
  Week
  Month
} derive(Eq, Debug, @quickcheck.Arbitrary)

///|
/// As JS writes a granularity.
pub impl ToJson for Granularity with fn to_json(self) {
  Json::string(
    match self {
      Day => "day"
      Week => "week"
      Month => "month"
    },
  )
}

///|
pub impl FromJson for Granularity with fn from_json(json, path) {
  match json {
    String("day") => Day
    String("week") => Week
    String("month") => Month
    _ => raise @json.JsonDecodeError((path, "a granularity"))
  }
}

///|
pub fn Granularity::name(self : Granularity) -> String {
  match self {
    Day => "day"
    Week => "week"
    Month => "month"
  }
}

///|
/// The calendar fields of a UTC timestamp: what a Date's getUTC* methods read.
priv struct Civil {
  year : Int32
  month : Int32 // 0 to 11.
  date : Int32 // 1 to 31.
  hours : Int32
  minutes : Int32
  weekday : Int32 // 0 is Sunday.
}

///|
fn floor_div(a : Int32, b : Int32) -> Int32 {
  let q = a / b
  if a % b != 0 && (a < 0) != (b < 0) {
    q - 1
  } else {
    q
  }
}

///|
/// Days since the epoch of a proleptic Gregorian date; month is 1 to 12.
fn days_from_civil(y : Int32, m : Int32, d : Int32) -> Int32 {
  let y = if m <= 2 { y - 1 } else { y }
  let era = floor_div(y, 400)
  let yoe = y - era * 400
  let mp = if m > 2 { m - 3 } else { m + 9 }
  let doy = (153 * mp + 2) / 5 + d - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  era * 146097 + doe - 719468
}

///|
/// Date.UTC(y, month, d, h, mi, s), with month 0 to 11 and overflowing months carried.
pub fn utc(
  y : Int32,
  month : Int32,
  d : Int32,
  h~ : Int32 = 0,
  mi~ : Int32 = 0,
  s~ : Int32 = 0,
) -> Double {
  let y = y + floor_div(month, 12)
  let m = month - floor_div(month, 12) * 12
  let days = days_from_civil(y, m + 1, 1) + d - 1
  days.to_double() * day +
  h.to_double() * hour +
  mi.to_double() * minute +
  s.to_double() * 1000.0
}

///|
fn civil(ts : Double) -> Civil {
  let days = (ts / day).floor()
  let ms = (ts - days * day).to_int()
  let z = days.to_int() + 719468
  let era = floor_div(z, 146097)
  let doe = z - era * 146097
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp = (5 * doy + 2) / 153
  let date = doy - (153 * mp + 2) / 5 + 1
  let m = if mp < 10 { mp + 3 } else { mp - 9 }
  let year = yoe + era * 400 + (if m <= 2 { 1 } else { 0 })
  let wd = (days.to_int() + 4) % 7
  {
    year,
    month: m - 1,
    date,
    hours: ms / 3600000,
    minutes: ms % 3600000 / 60000,
    weekday: if wd < 0 {
      wd + 7
    } else {
      wd
    },
  }
}

///|
/// The calendar fields of ts's local time.
fn local_time(ts : Double, tz : Int32) -> Civil {
  civil(ts + tz.to_double() * minute)
}

///|
fn from_local(t : Double, tz : Int32) -> Double {
  t - tz.to_double() * minute
}

///|
fn pad(n : Int32) -> String {
  n.to_string().pad_start(2, '0')
}

///|
pub fn start_of_day(ts : Double, tz : Int32) -> Double {
  let d = local_time(ts, tz)
  from_local(utc(d.year, d.month, d.date), tz)
}

///|
pub fn start_of_iso_week(ts : Double, tz : Int32) -> Double {
  let dow = match local_time(ts, tz).weekday {
    0 => 7
    n => n
  }
  start_of_day(ts, tz) - (dow - 1).to_double() * day
}

///|
pub fn start_of_month(ts : Double, tz : Int32) -> Double {
  let d = local_time(ts, tz)
  from_local(utc(d.year, d.month, 1), tz)
}

///|
/// The start of the bucket of ts.
pub fn bucket_start(
  ts : Double,
  granularity : Granularity,
  tz : Int32,
) -> Double {
  match granularity {
    Day => start_of_day(ts, tz)
    Week => start_of_iso_week(ts, tz)
    Month => start_of_month(ts, tz)
  }
}

///|
/// The start of the next bucket, by calendar.
pub fn bucket_end(
  start : Double,
  granularity : Granularity,
  tz : Int32,
) -> Double {
  match granularity {
    Day => start_of_day(start + day + 2.0 * hour, tz)
    Week => start_of_day(start + 7.0 * day + 2.0 * hour, tz)
    Month => {
      let d = local_time(start, tz)
      from_local(utc(d.year, d.month + 1, 1), tz)
    }
  }
}

///|
pub fn day_key(ts : Double, tz : Int32) -> String {
  let d = local_time(ts, tz)
  "\{d.year}-\{pad(d.month + 1)}-\{pad(d.date)}"
}

///|
pub fn month_key(ts : Double, tz : Int32) -> String {
  prefix(day_key(ts, tz), 7)
}

///|
pub fn iso_week_key(ts : Double, tz : Int32) -> String {
  let start = start_of_day(ts, tz) + tz.to_double() * minute
  let dow = match civil(start).weekday {
    0 => 7
    n => n
  }
  let thursday = start + (4 - dow).to_double() * day
  let y = civil(thursday).year
  let week = (((thursday - utc(y, 0, 1)) / day + 1.0) / 7.0).ceil().to_int()
  "\{y}-W\{pad(week)}"
}

///|
/// The key of ts's bucket.
pub fn bucket_key(ts : Double, granularity : Granularity, tz : Int32) -> String {
  match granularity {
    Day => day_key(ts, tz)
    Week => iso_week_key(ts, tz)
    Month => month_key(ts, tz)
  }
}

///|
/// 24 hour "HH:MM", where the original used the locale's format.
pub fn format_time(ts : Double, tz : Int32) -> String {
  let d = local_time(ts, tz)
  "\{pad(d.hours)}:\{pad(d.minutes)}"
}

///|
/// "Fri 16 Oct", with the year when it isn't now's; `weekday` false leaves it out.
pub fn format_date(
  ts : Double,
  tz : Int32,
  weekday~ : Bool = true,
  now? : Double,
) -> String {
  let d = local_time(ts, tz)
  let head = (if weekday { "\{weekdays[d.weekday]} " } else { "" }) +
    "\{d.date} \{months[d.month]}"
  if local_time(now.unwrap_or(ts), tz).year == d.year {
    head
  } else {
    "\{head} \{d.year}"
  }
}

///|
pub fn format_relative(ts : Double, now : Double, tz : Int32) -> String {
  let diff = now - ts
  if diff < 0.0 {
    return "scheduled"
  }
  if diff < 45000.0 {
    return "just now"
  }
  if diff < hour {
    return "\{js_round(diff / minute).to_int()}m ago"
  }
  if diff < day {
    return "\{js_round(diff / hour).to_int()}h ago"
  }
  let days = js_round((start_of_day(now, tz) - start_of_day(ts, tz)) / day).to_int()
  if days == 1 {
    "yesterday"
  } else if days < 7 {
    "\{days}d ago"
  } else {
    format_date(ts, tz, weekday=false)
  }
}

///|
pub fn format_bucket_label(
  start : Double,
  granularity : Granularity,
  now : Double,
  tz : Int32,
) -> String {
  let d = local_time(start, tz)
  match granularity {
    Month => "\{long_months[d.month]} \{d.year}"
    Week => {
      let end = local_time(start + 6.0 * day + 2.0 * hour, tz)
      let from = if end.month == d.month {
        d.date.to_string()
      } else {
        "\{d.date} \{months[d.month]}"
      }
      "\{from} – \{end.date} \{months[end.month]}"
    }
    Day => {
      let diff = js_round((start_of_day(now, tz) - start) / day).to_int()
      if diff == 0 {
        "Today"
      } else if diff == 1 {
        "Yesterday"
      } else {
        format_date(start, tz, now~)
      }
    }
  }
}

///|
/// The value of a datetime-local input: "2026-10-16T10:30".
pub fn to_datetime_local(ts : Double, tz : Int32) -> String {
  let d = local_time(ts, tz)
  "\{day_key(ts, tz)}T\{pad(d.hours)}:\{pad(d.minutes)}"
}

///|
/// The digits of text from start, exactly n of them.
fn digits_at(text : Array[Char], start : Int32, n : Int32) -> Int32? {
  if start + n > text.length() {
    return None
  }
  let mut v = 0
  for i in start..<(start + n) {
    match text[i] {
      '0'..<='9' as c => v = v * 10 + (c.to_int() - '0'.to_int())
      _ => return None
    }
  }
  Some(v)
}

///|
/// The timestamp a datetime-local value means, or None when it isn't one. Out of range
/// fields roll over, as Date.UTC does.
pub fn from_datetime_local(text : String, tz : Int32) -> Double? {
  let cs = text.to_array()
  guard cs.length() == 16 || cs.length() == 19 else { None }
  guard cs[4] == '-' && cs[7] == '-' && cs[10] == 'T' && cs[13] == ':' else {
    None
  }
  guard digits_at(cs, 0, 4) is Some(y) &&
    digits_at(cs, 5, 2) is Some(mo) &&
    digits_at(cs, 8, 2) is Some(d) &&
    digits_at(cs, 11, 2) is Some(h) &&
    digits_at(cs, 14, 2) is Some(mi) else {
    None
  }
  let s = if cs.length() == 19 {
    guard cs[16] == ':' && digits_at(cs, 17, 2) is Some(s) else { return None }
    s
  } else {
    0
  }
  Some(from_local(utc(y, mo - 1, d, h~, mi~, s~), tz))
}

///|
/// "today", "yesterday" or "N days ago", for backups.
pub fn days_ago(ts : Double, now : Double) -> String {
  let days = ((now - ts) / day).floor().to_int()
  if days == 0 {
    "today"
  } else if days == 1 {
    "yesterday"
  } else {
    "\{days} days ago"
  }
}
