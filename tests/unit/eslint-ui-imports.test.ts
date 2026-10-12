import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Lints `code` as if it were the file at `filePath`, under the repo's config.
 * @param code - The source text.
 * @param filePath - The path whose config blocks apply.
 * @returns The `no-restricted-imports` messages.
 */
async function restrictedImports(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js' })
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

describe('vendored ui imports', () => {
  it.each(['src/components/ui/badge.tsx', 'src/components/ui/sidebar.tsx'])(
    'bans cmdk and @radix-ui in vendored ui file %s but lets it import cn',
    async (file) => {
      expect(await restrictedImports("import { Command } from 'cmdk'", file)).toEqual([
        expect.stringContaining('Base UI Autocomplete'),
      ])
      expect(await restrictedImports("import * as X from '@radix-ui/react-slot'", file)).toEqual([
        expect.stringContaining('Base UI'),
      ])
      expect(await restrictedImports("import { cn } from 'cn'", file)).toEqual([])
    },
    60_000
  )
})
