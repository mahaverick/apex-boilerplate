/**
 * @file The check on `E2E_API_DIR`, the express checkout the live e2e helpers
 * run commands in. Pure: the file system arrives as arguments so a unit test
 * can drive every branch.
 */

/**
 * Decides whether `E2E_API_DIR` names a directory a helper can run in.
 * @param input - The value and the file system.
 * @param input.apiDir - The `E2E_API_DIR` value, or `undefined` when unset.
 * @param input.use - What the helper runs there, for the message.
 * @param input.script - A `package.json` script the helper runs, or `undefined` when it runs none.
 * @param input.realpath - Resolves a path's symlinks; throws when it does not exist.
 * @param input.readJson - A JSON file's parsed contents, or `null` when it is missing or invalid.
 * @returns `{ refusal }` naming what to change, or the resolved `{ dir }`.
 */
export function apiDirPlan({ apiDir, use, script, realpath, readJson }) {
  if (!apiDir) {
    return {
      refusal: `${use} runs in E2E_API_DIR, which is unset: set it to the express checkout whose database the API under test uses`,
    }
  }
  let dir
  try {
    dir = realpath(apiDir)
  } catch {
    return { refusal: `${use} runs in E2E_API_DIR, and ${apiDir} does not exist` }
  }
  const pkg = readJson(`${dir}/package.json`)
  if (pkg === null) {
    return {
      refusal: `${use} runs in E2E_API_DIR, and ${dir} has no readable package.json: point it at an express checkout`,
    }
  }
  if (script !== undefined) {
    const scripts = pkg.scripts
    if (typeof scripts !== 'object' || scripts === null || !(script in scripts)) {
      return {
        refusal: `${use} runs in E2E_API_DIR, and ${dir}/package.json has no ${script} script: point it at an express checkout`,
      }
    }
  }
  return { dir }
}
