// The Wax helpers lowered code calls: JavaScript's semantics for what the
// runtime's ABI doesn't give as is (a read past a list's end is undefined, a
// member a map doesn't have too, `%` is fmod's, slices take negative
// indexes). Every lowered module carries its own copy, as hand-written
// implementations carry theirs.

///|
let runtime_helpers : String =
  #|import "'" {
  #|    #[import = ""]
  #|    const pl_hs_empty: js_string;
  #|    #[import = "true"]
  #|    const pl_hs_true: js_string;
  #|    #[import = "false"]
  #|    const pl_hs_false: js_string;
  #|    #[import = "null"]
  #|    const pl_hs_null: js_string;
  #|    #[import = "undefined"]
  #|    const pl_hs_undefined: js_string;
  #|    #[import = "boolean"]
  #|    const pl_hs_boolean: js_string;
  #|    #[import = "number"]
  #|    const pl_hs_number: js_string;
  #|    #[import = "string"]
  #|    const pl_hs_string: js_string;
  #|    #[import = "list"]
  #|    const pl_hs_list: js_string;
  #|    #[import = "object"]
  #|    const pl_hs_object: js_string;
  #|    #[import = "component"]
  #|    const pl_hs_component: js_string;
  #|    #[import = "a swap gives a component, or nothing"]
  #|    const pl_hs_bad_swap: js_string;
  #|    #[import = "range makes at most 1000000 items"]
  #|    const pl_hs_bad_range: js_string;
  #|    #[import = "Object.fromEntries can't make a record with a key constructor, prototype or __proto__"]
  #|    const pl_hs_reserved_key: js_string;
  #|    #[import = "constructor"]
  #|    const pl_hs_constructor: js_string;
  #|    #[import = "prototype"]
  #|    const pl_hs_prototype: js_string;
  #|    #[import = "__proto__"]
  #|    const pl_hs_proto: js_string;
  #|    #[import = "a list index must be a whole number from 0 to the list's length"]
  #|    const pl_hs_bad_index: js_string;
  #|    #[import = "json_parse"]
  #|    const pl_hs_json_parse: js_string;
  #|    #[import = "message"]
  #|    const pl_hs_message: js_string;
  #|}
  #|
  #|// n as an i32, truncated and clamped (NaN is 0): what an index or a slice
  #|// bound is.
  #|fn pl_to_i32(n: f64) -> i32 {
  #|    if n != n {
  #|        return 0;
  #|    }
  #|    if n <= -2147483648.0 {
  #|        return -2147483647 - 1;
  #|    }
  #|    if n >= 2147483647.0 {
  #|        return 2147483647;
  #|    }
  #|    n.trunc() as i32_s;
  #|}
  #|
  #|// What a swap gives, a component: anything else fails the task.
  #|fn pl_component(v: &value) -> &component {
  #|    if v.kind != value_kind_component {
  #|        tutuca_fail(pl_hs_bad_swap);
  #|    }
  #|    (v as &value_component).component as &component;
  #|}
  #|
  #|// n as a list index, or -1 when it isn't one (negative, fractional, NaN).
  #|fn pl_index(n: f64) -> i32 {
  #|    if (n != n) | (n < 0.0) | (n >= 2147483647.0) {
  #|        return -1;
  #|    }
  #|    if n.trunc() != n {
  #|        return -1;
  #|    }
  #|    n as i32_s;
  #|}
  #|
  #|fn pl_nullish(v: &value) -> i32 {
  #|    (v.kind == value_kind_null) | (v.kind == value_kind_undefined);
  #|}
  #|
  #|// ctx.sourceKey: the key the message came from, an index as a number, a
  #|// name as a string; undefined when there's none.
  #|fn pl_source_key(ctx: &context) -> &value {
  #|    let key = ctx.source_key;
  #|    if !key {
  #|        return value_undefined();
  #|    }
  #|    let k = key!;
  #|    if k.kind == path_key_kind_index {
  #|        return value_number((k as &path_key_index).index as f64_s);
  #|    }
  #|    value_string((k as &path_key_name).name);
  #|}
  #|
  #|// list[i]: undefined past the end, or when list isn't one.
  #|fn pl_list_get(list: &value, i: i32) -> &value {
  #|    if list.kind != value_kind_list {
  #|        return value_undefined();
  #|    }
  #|    if (i <s 0) | (i >=s list_count(list)) {
  #|        return value_undefined();
  #|    }
  #|    list_get(list, i)!;
  #|}
  #|
  #|// list with item at i: replaced, or pushed at the end; anywhere else is
  #|// undefined behaviour, which fails the task.
  #|fn pl_list_set(list: &value, i: i32, item: &value) -> &value {
  #|    let n = list_count(list);
  #|    if (i >=s 0) & (i <s n) {
  #|        return list_assoc(list, i, item);
  #|    }
  #|    if i != n {
  #|        tutuca_fail(pl_hs_bad_index);
  #|    }
  #|    list_push(list, item);
  #|}
  #|
  #|// v.name: a map's member, a component's field, or undefined.
  #|fn pl_member(v: &value, name: js_string) -> &value {
  #|    if v.kind == value_kind_map {
  #|        let found = map_get(v, name);
  #|        if !found {
  #|            return value_undefined();
  #|        }
  #|        return found!;
  #|    }
  #|    if v.kind == value_kind_component {
  #|        return value_member(v, name);
  #|    }
  #|    value_undefined();
  #|}
  #|
  #|// A condition's argument i, undefined past the end.
  #|fn pl_arg(args: &value_array, i: i32) -> &value {
  #|    if i >=s args.length() {
  #|        return value_undefined();
  #|    }
  #|    let a = args[i];
  #|    if !a {
  #|        return value_undefined();
  #|    }
  #|    a!;
  #|}
  #|
  #|// v[n] for a number n.
  #|fn pl_index_get(v: &value, n: f64) -> &value {
  #|    if v.kind == value_kind_list {
  #|        return pl_list_get(v, pl_index(n));
  #|    }
  #|    value_undefined();
  #|}
  #|
  #|// list.at(n)'s index: from the end when negative.
  #|fn pl_at_index(list: &value, n: f64) -> f64 {
  #|    let i = n.trunc();
  #|    if i < 0.0 {
  #|        return i + (list_count(list) as f64_s);
  #|    }
  #|    i;
  #|}
  #|
  #|fn pl_length(v: &value) -> f64 {
  #|    if v.kind == value_kind_list {
  #|        return list_count(v) as f64_s;
  #|    }
  #|    if v.kind == value_kind_string {
  #|        return js_string_length(value_string_of(v)) as f64_s;
  #|    }
  #|    0.0;
  #|}
  #|
  #|// String(v).
  #|fn pl_text(v: &value) -> js_string {
  #|    let kind = v.kind;
  #|    if kind == value_kind_string {
  #|        return value_string_of(v)!;
  #|    }
  #|    if kind == value_kind_number {
  #|        return number_text(value_to_f64(v));
  #|    }
  #|    if kind == value_kind_bool {
  #|        if value_truthy(v) {
  #|            return pl_hs_true;
  #|        }
  #|        return pl_hs_false;
  #|    }
  #|    if kind == value_kind_null {
  #|        return pl_hs_null;
  #|    }
  #|    if kind == value_kind_undefined {
  #|        return pl_hs_undefined;
  #|    }
  #|    value_json(v, 0);
  #|}
  #|
  #|// A value the checker says is a string.
  #|fn pl_string_of(v: &value) -> js_string {
  #|    let s = value_string_of(v);
  #|    if !s {
  #|        return pl_text(v);
  #|    }
  #|    s!;
  #|}
  #|
  #|// a % b: the sign of a, as fmod.
  #|fn pl_rem(a: f64, b: f64) -> f64 {
  #|    if (b != b) | (b == 0.0) | (a != a) {
  #|        return 0.0 / 0.0;
  #|    }
  #|    a - b * (a / b).trunc();
  #|}
  #|
  #|fn pl_round(x: f64) -> f64 {
  #|    (x + 0.5).floor();
  #|}
  #|
  #|fn pl_max(a: f64, b: f64) -> f64 {
  #|    if (a != a) | (b != b) {
  #|        return 0.0 / 0.0;
  #|    }
  #|    if b > a {
  #|        return b;
  #|    }
  #|    a;
  #|}
  #|
  #|fn pl_min(a: f64, b: f64) -> f64 {
  #|    if (a != a) | (b != b) {
  #|        return 0.0 / 0.0;
  #|    }
  #|    if b < a {
  #|        return b;
  #|    }
  #|    a;
  #|}
  #|
  #|// a < b is pl_str_compare(a, b) <s 0: by UTF-16 code units, as JS.
  #|fn pl_str_compare(a: js_string, b: js_string) -> i32 {
  #|    let na = js_string_length(a);
  #|    let nb = js_string_length(b);
  #|    let i = 0;
  #|    while (i <s na) & (i <s nb) {
  #|        let ca = js_string_char_code_at(a, i);
  #|        let cb = js_string_char_code_at(b, i);
  #|        if ca != cb {
  #|            return ca - cb;
  #|        }
  #|        i += 1;
  #|    }
  #|    na - nb;
  #|}
  #|
  #|fn pl_starts_with(s: js_string, p: js_string) -> i32 {
  #|    let n = js_string_length(p);
  #|    if n >s js_string_length(s) {
  #|        return 0;
  #|    }
  #|    str_eq(str_slice(s, 0, n), p);
  #|}
  #|
  #|fn pl_ends_with(s: js_string, p: js_string) -> i32 {
  #|    let n = js_string_length(p);
  #|    let m = js_string_length(s);
  #|    if n >s m {
  #|        return 0;
  #|    }
  #|    str_eq(str_slice(s, m - n, m), p);
  #|}
  #|
  #|fn pl_str_slice(s: js_string, start: f64, end: f64) -> js_string {
  #|    str_slice(s, pl_to_i32(start), pl_to_i32(end));
  #|}
  #|
  #|// A slice bound: from the end when negative, clamped to 0..n.
  #|fn pl_bound(x: f64, n: i32) -> i32 {
  #|    let i = pl_to_i32(x);
  #|    if i <s 0 {
  #|        i = i + n;
  #|        if i <s 0 {
  #|            return 0;
  #|        }
  #|        return i;
  #|    }
  #|    if i >s n {
  #|        return n;
  #|    }
  #|    i;
  #|}
  #|
  #|fn pl_list_slice(list: &value, start: f64, end: f64) -> &value {
  #|    let n = list_count(list);
  #|    let i = pl_bound(start, n);
  #|    let j = pl_bound(end, n);
  #|    let out = list_empty();
  #|    while i <s j {
  #|        out = list_push(out, list_get(list, i)!);
  #|        i += 1;
  #|    }
  #|    out;
  #|}
  #|
  #|// tutuca/data's range(start, end): the whole numbers from start (up) to end.
  #|fn pl_range(start: f64, end: f64) -> &value {
  #|    let from = start.ceil();
  #|    if !(end - from <= 1000000.0) {
  #|        tutuca_fail(pl_hs_bad_range);
  #|        return list_empty();
  #|    }
  #|    let out = list_empty();
  #|    let i = from;
  #|    while i < end {
  #|        out = list_push(out, value_number(i));
  #|        i = i + 1.0;
  #|    }
  #|    out;
  #|}
  #|
  #|// tutuca/data's get(value, key): an object's own member key, a list's item
  #|// at index key; undefined otherwise.
  #|fn pl_get(v: &value, key: &value) -> &value {
  #|    if (v.kind == value_kind_list) & pl_is_number(key) {
  #|        return pl_list_get(v, pl_index(value_to_f64(key)));
  #|    }
  #|    if (v.kind == value_kind_map) & (key.kind == value_kind_string) {
  #|        let found = map_get(v, (key as &value_string).value);
  #|        if !found {
  #|            return value_undefined();
  #|        }
  #|        return found!;
  #|    }
  #|    value_undefined();
  #|}
  #|
  #|// tutuca/data's keysOf(value): an object's own keys, in order, [] for
  #|// anything else.
  #|fn pl_keys_of(v: &value) -> &value {
  #|    if v.kind == value_kind_map {
  #|        return map_keys(v);
  #|    }
  #|    list_empty();
  #|}
  #|
  #|// tutuca/data's itemsOf(value): a list's items, [] for anything else.
  #|fn pl_items_of(v: &value) -> &value {
  #|    if v.kind == value_kind_list {
  #|        return v;
  #|    }
  #|    list_empty();
  #|}
  #|
  #|// tutuca.errorMessage(error): String(error.message ?? error), what an
  #|// error answer says.
  #|fn pl_error_message(v: &value) -> js_string {
  #|    if v.kind == value_kind_map {
  #|        let m = map_get(v, pl_hs_message);
  #|        if !!m {
  #|            let mv = m!;
  #|            if (mv.kind != value_kind_null) & (mv.kind != value_kind_undefined) {
  #|                return pl_text(mv);
  #|            }
  #|        }
  #|    }
  #|    pl_text(v);
  #|}
  #|
  #|// tutuca/data's parseJson(text): the value JSON text is (the runtime's
  #|// json_parse, JSON.parse), undefined when it isn't JSON.
  #|fn pl_parse_json(text: js_string) -> &value {
  #|    let r = host_call(pl_hs_json_parse, list_push(list_empty(), value_string(text)));
  #|    if !outcome_is_ok(r) {
  #|        return value_undefined();
  #|    }
  #|    outcome_value(r);
  #|}
  #|
  #|// typeof v, as JavaScript says it: null, a list and a component are objects.
  #|fn pl_typeof(v: &value) -> js_string {
  #|    let kind = v.kind;
  #|    if kind == value_kind_undefined {
  #|        return pl_hs_undefined;
  #|    }
  #|    if kind == value_kind_bool {
  #|        return pl_hs_boolean;
  #|    }
  #|    if kind == value_kind_number {
  #|        return pl_hs_number;
  #|    }
  #|    if kind == value_kind_string {
  #|        return pl_hs_string;
  #|    }
  #|    pl_hs_object;
  #|}
  #|
  #|// tutuca/data's kindOf(value).
  #|fn pl_kind_of(v: &value) -> js_string {
  #|    let kind = v.kind;
  #|    if kind == value_kind_null {
  #|        return pl_hs_null;
  #|    }
  #|    if kind == value_kind_undefined {
  #|        return pl_hs_undefined;
  #|    }
  #|    if kind == value_kind_bool {
  #|        return pl_hs_boolean;
  #|    }
  #|    if kind == value_kind_number {
  #|        return pl_hs_number;
  #|    }
  #|    if kind == value_kind_string {
  #|        return pl_hs_string;
  #|    }
  #|    if kind == value_kind_list {
  #|        return pl_hs_list;
  #|    }
  #|    if kind == value_kind_component {
  #|        return pl_hs_component;
  #|    }
  #|    pl_hs_object;
  #|}
  #|
  #|// Object.entries(record): [key, value] lists, in the record's order.
  #|fn pl_entries(dict: &value) -> &value {
  #|    let out = list_empty();
  #|    if dict.kind != value_kind_map {
  #|        return out;
  #|    }
  #|    let keys = map_keys(dict);
  #|    let i = 0;
  #|    while i <s list_count(keys) {
  #|        let key = list_get(keys, i)!;
  #|        let pair = list_push(list_push(list_empty(), key), map_get(dict, value_string_of(key)!)!);
  #|        out = list_push(out, pair);
  #|        i += 1;
  #|    }
  #|    out;
  #|}
  #|
  #|fn pl_reserved(key: js_string) -> i32 {
  #|    str_eq(key, pl_hs_constructor) | str_eq(key, pl_hs_prototype) | str_eq(key, pl_hs_proto);
  #|}
  #|
  #|// Object.fromEntries(entries): a reserved key is undefined behaviour.
  #|fn pl_from_entries(entries: &value) -> &value {
  #|    let out = map_empty();
  #|    let i = 0;
  #|    while i <s list_count(entries) {
  #|        let pair = list_get(entries, i)!;
  #|        let key = pl_string_of(pl_list_get(pair, 0));
  #|        if pl_reserved(key) {
  #|            tutuca_fail(pl_hs_reserved_key);
  #|        }
  #|        out = map_assoc(out, key, pl_list_get(pair, 1));
  #|        i += 1;
  #|    }
  #|    out;
  #|}
  #|
  #|fn pl_has_own(dict: &value, key: js_string) -> i32 {
  #|    if dict.kind != value_kind_map {
  #|        return 0;
  #|    }
  #|    map_has(dict, key);
  #|}
  #|
  #|fn pl_is_number(v: &value) -> i32 {
  #|    v.kind == value_kind_number;
  #|}
  #|
  #|fn pl_is_integer(v: &value) -> i32 {
  #|    if !pl_is_number(v) {
  #|        return 0;
  #|    }
  #|    let n = value_to_f64(v);
  #|    (n == n) & (n.trunc() == n) & (n - n == 0.0);
  #|}
  #|
  #|fn pl_is_finite(v: &value) -> i32 {
  #|    if !pl_is_number(v) {
  #|        return 0;
  #|    }
  #|    let n = value_to_f64(v);
  #|    n - n == 0.0;
  #|}
  #|
  #|fn pl_is_nan(v: &value) -> i32 {
  #|    if !pl_is_number(v) {
  #|        return 0;
  #|    }
  #|    let n = value_to_f64(v);
  #|    n != n;
  #|}
  #|
  #|fn pl_sign(x: f64) -> f64 {
  #|    if x > 0.0 {
  #|        return 1.0;
  #|    }
  #|    if x < 0.0 {
  #|        return -1.0;
  #|    }
  #|    x;
  #|}
  #|
  #|// A check of a value: what lowered code checks the page's results with.
  #|type pl_fits_fn = fn(&value) -> i32;
  #|
  #|// What a page's host function gave ({ ok } or { err }): its value, or
  #|// (what it threw) a failure.
  #|fn pl_host_result(r: &value) -> &value {
  #|    if !outcome_is_ok(r) {
  #|        tutuca_fail(pl_text(outcome_value(r)));
  #|        return value_undefined();
  #|    }
  #|    outcome_value(r);
  #|}
  #|
  #|// Whether every item of a list fits.
  #|fn pl_every_item(list: &value, fits: &pl_fits_fn) -> i32 {
  #|    if list.kind != value_kind_list {
  #|        return 0;
  #|    }
  #|    let i = 0;
  #|    while i <s list_count(list) {
  #|        if !fits(list_get(list, i)!) {
  #|            return 0;
  #|        }
  #|        i += 1;
  #|    }
  #|    1;
  #|}
  #|
  #|// Data, all the way down (what unknown is from the page).
  #|fn pl_is_data: pl_fits_fn (v: &value) -> i32 {
  #|    let kind = v.kind;
  #|    if kind == value_kind_list {
  #|        return pl_every_item(v, pl_is_data);
  #|    }
  #|    if kind == value_kind_map {
  #|        return pl_every_item(map_values(v), pl_is_data);
  #|    }
  #|    kind != value_kind_component;
  #|}
  #|
  #|// The first index of an item === needle, or -1.
  #|fn pl_index_of(list: &value, needle: &value) -> i32 {
  #|    let n = list_count(list);
  #|    let i = 0;
  #|    while i <s n {
  #|        if value_same(list_get(list, i)!, needle) {
  #|            return i;
  #|        }
  #|        i += 1;
  #|    }
  #|    -1;
  #|}
  #|
