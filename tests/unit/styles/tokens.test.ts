/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')

/** The custom properties one selector block declares, name → value. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']))
}

const light = block(':root')
const dark = block('.dark')

describe('theme tokens', () => {
  it('declares every light token in dark too', () => {
    const missing = [...light.keys()].filter((name) => name !== '--radius' && !dark.has(name))
    expect(missing).toEqual([])
  })

  it.each(['success', 'warning', 'info'])(
    'declares --%s and its foreground in both themes',
    (name) => {
      for (const theme of [light, dark]) {
        expect(theme.has(`--${name}`)).toBe(true)
        expect(theme.has(`--${name}-foreground`)).toBe(true)
      }
    }
  )

  it('exposes the status tokens to Tailwind', () => {
    for (const name of ['success', 'warning', 'info']) {
      expect(css).toContain(`--color-${name}: var(--${name});`)
      expect(css).toContain(`--color-${name}-foreground: var(--${name}-foreground);`)
    }
  })

  it('tints the neutrals: background, sidebar and border carry chroma', () => {
    for (const name of ['--background', '--sidebar', '--border', '--muted']) {
      const chroma = Number((light.get(name) ?? '').match(/oklch\(\s*[\d.]+\s+([\d.]+)/)?.[1])
      expect(chroma).toBeGreaterThan(0)
    }
  })

  it('gives the five chart series five different hues', () => {
    const hues = [1, 2, 3, 4, 5].map((n) =>
      Number((light.get(`--chart-${n}`) ?? '').match(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/)?.[1])
    )
    expect(new Set(hues).size).toBe(5)
  })
})
