/**
 * The text to show for a failed command. The backend rejects with a
 * `CommandError` (`{ kind, message }`); the mock and the runtime throw
 * `Error`s. Both carry `message`.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}
