// The tcd command, natively: cli's pipeline over the file system.

///|
#borrow(s)
extern "C" fn write_stdout(s : Bytes, len : Int32) = "tcd_write_stdout"

///|
#borrow(s)
extern "C" fn write_stderr(s : Bytes, len : Int32) = "tcd_write_stderr"

///|
fn out(s : String) -> Unit {
  let b = @utf8.encode(s)
  write_stdout(b, b.length())
}

///|
fn err(s : String) -> Unit {
  let b = @utf8.encode(s)
  write_stderr(b, b.length())
}

///|
fn main {
  let io : @cli.Io = {
    read: p => Some(@fs.read_file_to_string(p)) catch { _ => None },
    write: (p, text) => {
      try {
        @fs.write_string_to_file(p, text)
        true
      } catch {
        _ => {
          err("tcd: can't write \{p}\n")
          false
        }
      }
    },
    write_bytes: (p, bytes) => {
      try {
        @fs.write_bytes_to_file(p, bytes)
        true
      } catch {
        _ => {
          err("tcd: can't write \{p}\n")
          false
        }
      }
    },
    out,
    err,
  }
  let args = @env.args()
  @sys.exit(@cli.run(args[1:].to_owned(), io))
}
