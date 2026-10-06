import type { Page } from '@playwright/test'

/** An email address anywhere in a text node. */
const EMAIL_SOURCE = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`

/**
 * Every text node on `page` that holds an email address or one of `names`
 * and does not sit inside a `.ph-sensitive.ph-mask` element (`Pii`): text
 * that autocapture and replay would send as it is. Attributes are not
 * checked here; posthog-js's attribute masking covers those, and a
 * `<textarea>`'s text is skipped: its value is a form control's, which replay
 * masks (`maskAllInputs`) and autocapture never reads as element text.
 */
export async function unmaskedPii(page: Page, names: readonly string[]): Promise<string[]> {
  return page.evaluate(
    ({ emailSource, needles }) => {
      const email = new RegExp(emailSource)
      const found: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? ''
        if (!email.test(text) && !needles.some((needle) => text.includes(needle))) continue
        const parent = node.parentElement
        if (parent === null || parent.closest('script, style, textarea') !== null) continue
        if (parent.closest('.ph-sensitive.ph-mask') === null) found.push(text.trim())
      }
      return found
    },
    { emailSource: EMAIL_SOURCE, needles: [...names] }
  )
}
