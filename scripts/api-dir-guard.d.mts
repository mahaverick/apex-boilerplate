export function apiDirPlan(input: {
  apiDir: string | undefined
  use: string
  script?: string
  realpath: (target: string) => string
  readJson: (file: string) => { scripts?: unknown } | null
}): { refusal: string } | { dir: string }
