name = "tutuca/tcd"

version = "0.1.0"

import {
  "marianoguerra/wax@0.3.1",
  "moonbitlang/x@0.5.5",
}

readme = "README.md"

license = "Apache-2.0"

description = "TCD: a WIT-style component definition language compiled to tutuca-wax"

preferred_target = "native"

// Every derive(Eq, Debug, ToJson) would report warning 79; wax-mb turns it
// off for the same reason.

warnings = "-implicit_impl_as_method"
