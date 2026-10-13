import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/features/skip-link'

/**
 * The signed-out page frame, after shadcn's login-03 block: a muted page with
 * one narrow column centred on it, which `AuthCard` fills with the app's name
 * and the card. `main` takes tabIndex -1 so the skip link can focus it
 * without adding a Tab stop.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <SkipLink />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex w-full max-w-sm flex-col gap-6 outline-none"
      >
        {children}
      </main>
    </div>
  )
}
