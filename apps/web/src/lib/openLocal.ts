// Deep links that open a project's local folder from the web app.
//
// Browsers block plain file:// navigation from an https page, so we rely on
// OS-registered URL schemes instead:
//   - vscode://file/<abs-path>  opens the folder in VS Code (Claude Code lives
//     there as an extension). Works out of the box once VS Code is installed.
//   - larvis://open?path=<abs-path>  is a custom scheme handled by the helper
//     in scripts/larvis-open: it opens a terminal at the folder and runs
//     `claude`. Needs the one-time installer (scripts/install-larvis-handler.sh).
//
// All of these only do something on the machine that actually holds the folder
// (i.e. the owner's own PC); elsewhere they no-op or prompt and fail harmlessly.

/** VS Code's URL handler. `path` is absolute (starts with `/` on Linux). */
export function vscodeUrl(path: string): string {
  return `vscode://file${encodeURI(path)}`;
}

/** Custom scheme consumed by scripts/larvis-open → terminal + `claude` at the folder. */
export function claudeCodeUrl(path: string): string {
  return `larvis://open?path=${encodeURIComponent(path)}`;
}

/** Shell snippet to paste into any terminal — the universal fallback. */
export function terminalCommand(path: string): string {
  // Single-quote the path and escape embedded single quotes for safe pasting.
  const quoted = `'${path.replace(/'/g, `'\\''`)}'`;
  return `cd ${quoted} && claude`;
}
