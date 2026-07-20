export type PortErrorCode =
  "NOT_FOUND" | "INVALID_INPUT" | "UNSUPPORTED" | "CONFLICT" | "INTERNAL";

/** The only error type that crosses the port boundary. */
export class PortError extends Error {
  constructor(
    readonly code: PortErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "PortError";
  }

  static notFound(kind: string, id: string): PortError {
    return new PortError(
      "NOT_FOUND",
      `${kind} ${id} not found`,
      `The ${kind} may have been deleted or the ID is stale. Call get_set to refresh IDs.`,
    );
  }
}
