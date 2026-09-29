/** The product name, and the suffix of every page title. */
export const APP_NAME = 'Apex'

/** A page's document title: `Profile` becomes `Profile · Apex`. */
export function pageTitle(page: string): string {
  return `${page} · ${APP_NAME}`
}
