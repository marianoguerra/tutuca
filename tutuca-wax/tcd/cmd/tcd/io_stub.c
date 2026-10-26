/* Writes to stdout and stderr, which MoonBit's core has no binding for:
 * diagnostics go to stderr, what a command prints (a stub, a model) to
 * stdout, so they can be redirected apart. And whether stderr is a terminal,
 * so diagnostics are colored only there. */
#include <stdio.h>
#include <unistd.h>
#include "moonbit.h"

MOONBIT_FFI_EXPORT void tcd_write_stdout(moonbit_bytes_t s, int32_t len) {
    fwrite((const char *)s, 1, (size_t)len, stdout);
    fflush(stdout);
}

MOONBIT_FFI_EXPORT void tcd_write_stderr(moonbit_bytes_t s, int32_t len) {
    fwrite((const char *)s, 1, (size_t)len, stderr);
    fflush(stderr);
}

MOONBIT_FFI_EXPORT int32_t tcd_stderr_is_tty(void) {
    return isatty(fileno(stderr)) ? 1 : 0;
}
