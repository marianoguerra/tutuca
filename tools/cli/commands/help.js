export const describe = "Show usage. `help <command>` for per-command detail.";

const OVERVIEW = `tutuca — CLI for inspecting, documenting, linting and rendering tutuca
components defined in an ES module.

SYNOPSIS
  tutuca <module-path> <command> [name] [flags]
  tutuca help [command]
  tutuca {-h | --help}

INVOCATION SHAPE
  - <module-path> comes FIRST (before the command). It is a path to an ES
    module resolvable by Node (absolute, or relative to cwd).
  - [name] is an OPTIONAL component-name filter. Omit it to operate on all
    components; pass it to operate on exactly one (e.g. \`docs Button\`).
  - Flags may appear anywhere. Global flags and command flags share the
    same argv; unknown flags are rejected by the subcommand's parser.
  - \`help\` does NOT take a module path.

MODULE CONVENTION
  A module passed to tutuca must export one or more of:

    export function getComponents()       // required for all module commands
      -> Component[]                      // results of tutuca's component()

    export function getExamples()         // required for render/doctor
      -> Section | Section[]              // single section or an array
      where Section = { title: string, description?: string,
                        items: Example[] }
      and   Example = { title, description?, value, view? }
      and   value   = an instance returned by <Component>.make(...)
      and   view    = a view name (defaults to "main")

    export function getMacros()           // optional
      -> Record<string, Macro>            // from tutuca's macro()

    export function getRequestHandlers()  // optional
      -> Record<string, Function>

    export function getRoot()             // optional; returned by info

  The legacy \`getStoryBookSection()\` name fails fast with
  EXAMPLES_SHAPE_MISMATCH — rename it to \`getExamples\`.

COMMANDS (require <module-path>)
  info
      Summarize which getX() exports are present and count components,
      macros, request handlers, examples, and sections. Good first step.

  list
      List each component with its declared views and fields (name, type).

  examples
      Print the module's example sections: title, description, items.
      Each item shows its resolved component name and view.

  docs [name]
      Generate API docs (methods, input handlers, fields with their
      auto-generated accessor/mutator methods) for every component, or
      for the single component whose name matches [name].

  lint [name]
      Run the built-in component linter. Reports at levels error / warn
      / hint. Exits 2 if ANY finding is at error level.

  render [name] [--title <t>] [--view <v>]
      Render examples to HTML by running each example value through the
      component tree in a headless DOM. Filters:
        [name]       only examples whose value is an instance of <name>
        --title <t>  only the example with that title
        --view <v>   override the example's view name
      Exits 3 if any render crashes.

  doctor
      lint + render in one pass, producing a combined report. The smoke
      test invocation for CI. Exits 2 on lint errors, 3 on render crashes.

COMMANDS (no module required)
  help [command]
      Without [command]: prints this full reference.
      With [command]: prints that command's one-line description.

GLOBAL FLAGS
  -f, --format <cli|md|json|html>
      Output format. Defaults per command:
        info, list, examples, lint, doctor -> cli
        docs, render                       -> md
      html is only supported by render.
      json is supported by every command and serializes the result
      class directly — useful for piping into other tools or agents.

  -o, --output <file>        Write to <file> instead of stdout.
      --pretty               Pretty-print HTML (md/html formats) via
                             prettier; JSON formatter uses indent 2.
                             Requires \`prettier\` to be installed.
  -h, --help                 Show this help.
      --module <path>        Alternative to first-positional module path.

EXIT CODES
  0   success
  1   usage error (bad args, missing module, bad module shape)
  2   lint findings at error level
  3   render crash

ENVIRONMENT
  \`prettier\` is an optional peer dep, only used by --pretty.

EXAMPLES
  # Inspect a module
  tutuca ./src/components.js info

  # Machine-readable docs for one component
  tutuca ./src/components.js docs Button -f json -o docs/button.json

  # Render every example, pretty-printed HTML to a file
  tutuca ./src/components.js render -f html --pretty -o out/examples.html

  # Render a single example
  tutuca ./src/components.js render Button --title "Disabled state"

  # CI smoke test
  tutuca ./src/components.js doctor
`;

export async function run(argv) {
  const target = argv?.[0];
  if (!target) {
    process.stdout.write(OVERVIEW);
    return;
  }
  const { COMMAND_NAMES } = await import("./_registry.js");
  if (!COMMAND_NAMES.includes(target)) {
    process.stderr.write(`tutuca: unknown command: ${target}\n`);
    process.stderr.write("Run `tutuca help` for the full reference.\n");
    process.exit(1);
  }
  const mod = await import(`./${target}.js`);
  process.stdout.write(`${target}: ${mod.describe}\n`);
  process.stdout.write(
    "Run `tutuca help` for the full reference including signatures and flags.\n",
  );
}
