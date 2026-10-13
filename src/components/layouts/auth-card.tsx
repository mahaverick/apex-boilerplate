import type { ReactNode } from 'react'
import { AppMark } from '@/components/shared/app-mark'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { APP_NAME } from '@/constants/app'

/**
 * Every signed-out page's card, after shadcn's login-03 block: the app's mark
 * and name over a centred card whose header holds the page's one `h1`
 * (`title`) and its description, then the page's content. `footer` renders
 * under the card, outside it. The name is plain text, not a link: a
 * signed-out visitor has nowhere else to go, and a `#` link would be a dead
 * control.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <>
      <p className="flex items-center gap-2 self-center font-medium">
        <AppMark className="size-6 rounded-md bg-primary text-xs text-primary-foreground" />
        {APP_NAME}
      </p>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            <h1>{title}</h1>
          </CardTitle>
          {description && <CardDescription className="text-balance">{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent className="gap-6">{children}</CardContent>}
      </Card>
      {footer}
    </>
  )
}
