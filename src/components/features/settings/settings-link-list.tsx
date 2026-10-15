import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
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
        <ItemGroup className="gap-0 divide-y has-data-[size=sm]:gap-0">
          {sections.map((section) => (
            <div key={section.to} role="listitem">
              <Item size="sm" render={<Link to={section.to} />}>
                <ItemMedia>
                  <section.Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{section.label}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {section.description}
                  </ItemDescription>
                </ItemContent>
                <IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Item>
            </div>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
