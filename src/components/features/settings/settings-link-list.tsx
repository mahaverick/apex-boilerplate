import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SETTINGS_SECTIONS, type SettingsGroup } from '@/constants/settings'

/**
 * One group of the landing page: a card titled after the group, each section
 * a link with its icon, label and description.
 */
export function SettingsLinkList({ group }: { group: SettingsGroup }) {
  const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  const headingId = `settings-group-${group.id}`
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId}>{group.label}</h2>
        </CardTitle>
        <CardDescription>{group.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid divide-y">
          {sections.map((section) => (
            <li key={section.to}>
              <Link
                to={section.to}
                className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/50"
              >
                <section.Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
                <span className="grid flex-1 gap-0.5">
                  <span className="font-medium">{section.label}</span>
                  <span className="text-sm text-muted-foreground">{section.description}</span>
                </span>
                <IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
