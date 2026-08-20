export class CliError extends Error {
  constructor(message, { details = "", exitCode = 1 } = {}) {
    super(message);
    this.name = "CliError";
    this.details = details;
    this.exitCode = exitCode;
  }
}
