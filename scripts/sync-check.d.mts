/**
 * Check apex's copies of react-boilerplate's shared rows: each apex row byte
 * for byte, then the expo-row `check-shared` rules on the apex rows.
 * @returns One line per finding, empty when apex matches.
 */
export declare function syncCheck(options?: {
  root?: string
  react?: string
  env?: Record<string, string | undefined>
  warn?: (message: string) => void
}): string[]
