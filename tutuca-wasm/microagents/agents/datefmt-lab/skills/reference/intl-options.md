# Intl.DateTimeFormat options

| option | values |
|---|---|
| dateStyle | full, long, medium, short |
| timeStyle | full, long, medium, short |
| weekday | long, short, narrow |
| era | long, short, narrow |
| year | numeric, 2-digit |
| month | numeric, 2-digit, long, short, narrow |
| day | numeric, 2-digit |
| hour, minute, second | numeric, 2-digit |
| hour12 | true, false |
| timeZone | an IANA name (UTC, Europe/Berlin, America/New_York, …); UTC here when unset |
| timeZoneName | short, long, shortOffset, longOffset, shortGeneric, longGeneric |

Rules:
- `dateStyle` and `timeStyle` can't be mixed with the field options (weekday … second);
  Intl throws a TypeError.
- The locale is a BCP 47 tag: `en-US`, `de-DE`, `ja-JP-u-ca-japanese` (Japanese calendar),
  `ar-EG-u-nu-latn` (Latin digits).
- Spacing differs between ICU versions: `2:07 PM` may use a narrow no-break space (U+202F)
  before PM.
