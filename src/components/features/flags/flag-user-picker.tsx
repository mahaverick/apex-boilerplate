import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { fullName } from '@/lib/format'
import { SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { platformUsersQueryOptions } from '@/queries/user-admin.queries'

/** How many matches the picker lists. */
const PICKER_LIMIT = 8

/**
 * Finds a user through the staff directory search (`GET /platform/users`)
 * and hands back the one picked. Nothing is asked until something is typed.
 */
export function FlagUserPicker({ onPick }: { onPick: (userId: string) => void }) {
  const [draft, setDraft] = useState('')
  const term = useDebouncedValue(draft.trim(), SEARCH_DEBOUNCE_MS)
  const users = useQuery({
    ...platformUsersQueryOptions({ q: term, limit: PICKER_LIMIT }),
    enabled: term !== '',
  })
  const matches = term === '' ? [] : (users.data?.users ?? [])
  return (
    <div className="grid gap-2">
      <Input
        type="search"
        aria-label="Find a user"
        placeholder="Search by email or name"
        className="w-72"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {users.isError && term !== '' && (
        <p role="alert" className="text-sm text-muted-foreground">
          We could not search the directory.
        </p>
      )}
      {term !== '' && users.isSuccess && matches.length === 0 && (
        <p className="text-sm text-muted-foreground">No users match.</p>
      )}
      {matches.length > 0 && (
        <ul aria-label="Matching users" className="grid gap-1">
          {matches.map((user) => (
            <li key={user.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start py-1 text-left"
                onClick={() => onPick(user.id)}
              >
                <Pii className="grid">
                  <span className="font-medium">{fullName(user) ?? user.email}</span>
                  {fullName(user) !== null && (
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  )}
                </Pii>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
