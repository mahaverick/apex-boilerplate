/**
 * @file Hand-written, not vendored: shadcn's base-nova `command` is built on
 * cmdk, which pulls in Radix (shadcn-ui/ui#9191). This composes Base UI's
 * Autocomplete the way Base UI's own command-palette example does, keeping
 * shadcn's export names and base-nova styling.
 */
import { Autocomplete } from '@base-ui/react/autocomplete'
import { ScrollArea } from '@base-ui/react/scroll-area'
import { SearchIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** The Autocomplete root. A palette passes `open inline autoHighlight="always" keepHighlight`. */
const Command = Autocomplete.Root

/**
 * The palette's modal frame. Its title and description are for screen
 * readers only; the search box is the visible heading.
 */
function CommandDialog({
  title = 'Command palette',
  description = 'Search for a page or a tenant.',
  className,
  children,
  ...props
}: ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl p-0', className)}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: ComponentProps<typeof Autocomplete.Input>) {
  return (
    <Autocomplete.InputGroup
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 border-b px-3"
    >
      <SearchIcon aria-hidden className="size-4 shrink-0 opacity-50" />
      <Autocomplete.Input
        data-slot="command-input"
        className={cn(
          'flex h-10 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </Autocomplete.InputGroup>
  )
}

function CommandList({ className, ...props }: ComponentProps<typeof Autocomplete.List>) {
  return (
    <ScrollArea.Root className="max-h-72">
      <ScrollArea.Viewport className="max-h-72">
        <ScrollArea.Content>
          <Autocomplete.List
            data-slot="command-list"
            className={cn('scroll-py-1 p-1 outline-none', className)}
            {...props}
          />
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex w-2 justify-center p-0.5">
        <ScrollArea.Thumb className="w-full rounded-full bg-border" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof Autocomplete.Empty>) {
  return (
    <Autocomplete.Empty
      data-slot="command-empty"
      className={cn('py-6 text-center text-sm text-muted-foreground empty:hidden', className)}
      {...props}
    />
  )
}

function CommandGroup({ className, ...props }: ComponentProps<typeof Autocomplete.Group>) {
  return (
    <Autocomplete.Group
      data-slot="command-group"
      className={cn('overflow-hidden p-1 text-foreground', className)}
      {...props}
    />
  )
}

function CommandGroupLabel({
  className,
  ...props
}: ComponentProps<typeof Autocomplete.GroupLabel>) {
  return (
    <Autocomplete.GroupLabel
      data-slot="command-group-label"
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

const CommandCollection = Autocomplete.Collection

function CommandItem({ className, ...props }: ComponentProps<typeof Autocomplete.Item>) {
  return (
    <Autocomplete.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: ComponentProps<typeof Autocomplete.Separator>) {
  return (
    <Autocomplete.Separator
      data-slot="command-separator"
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
