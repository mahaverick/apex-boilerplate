import type { Page } from '@playwright/test'

/**
 * How far the page is too wide, in pixels: zero or less means nothing scrolls
 * sideways. The layout's content area is its own scroll container, so a page
 * too wide for it scrolls there and leaves the document's width alone; both
 * are measured.
 */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const content = document.querySelector('main > .overflow-auto')
    if (content === null) throw new Error('The layout’s content scroller is missing.')
    return Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      content.scrollWidth - content.clientWidth
    )
  })
}
