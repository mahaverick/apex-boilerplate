import { APP_NAME } from '@/constants/app'
import { cn } from '@/lib/utils'

/**
 * The app's logo mark: the first letter of `APP_NAME` in a rounded square.
 * Decorative, since the name always sits beside it. The caller sets the
 * colours, `bg-primary` on a page and `bg-sidebar-primary` in the sidebar,
 * and may change the size.
 */
export function AppMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex aspect-square shrink-0 items-center justify-center rounded-lg font-bold',
        className
      )}
    >
      {APP_NAME.charAt(0)}
    </span>
  )
}
