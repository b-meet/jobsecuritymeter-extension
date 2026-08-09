/**
 * Detecting that the extension has been reloaded out from under this page.
 *
 * Split into its own module so it can be tested without importing the content
 * script, which mounts UI and starts observers the moment it loads.
 */
export function isContextInvalidated(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Extension context invalidated");
}
