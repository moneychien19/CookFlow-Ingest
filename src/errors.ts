/** An error the user can fix (bad arguments, a bad data file, a failed check). CLIs print only its message. */
export class CliError extends Error {
  override name = "CliError";
}
