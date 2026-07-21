/**
 * Centralized AbortController for managing request lifecycle.
 * Prevents orphaned requests during logout or state resets.
 */

let abortController: AbortController = new AbortController();

export function getAbortSignal(): AbortSignal {
  return abortController.signal;
}

export function resetAbortController(): void {
  abortController.abort();
  abortController = new AbortController();
}
