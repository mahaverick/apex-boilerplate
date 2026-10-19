import { IconBrandGithub } from '@tabler/icons-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { SOCIAL_PROVIDERS } from '@/constants/auth-providers'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'

describe('SocialSignIn', () => {
  it('lists Google, the one provider the API offers', () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual(['google'])
  })

  it('builds the Google start URL for apex, with the redirect when there is one', () => {
    const [google] = SOCIAL_PROVIDERS
    expect(GOOGLE_OAUTH_PATH).toBe('/api/v1/auth/google?app=apex')
    expect(google?.hrefFor()).toBe(GOOGLE_OAUTH_PATH)
    expect(google?.hrefFor('/tenants/abc?tab=members')).toBe(
      `${GOOGLE_OAUTH_PATH}&redirect=%2Ftenants%2Fabc%3Ftab%3Dmembers`
    )
  })

  it('renders the "or" divider, then Google as a link to the OAuth start route', () => {
    render(<SocialSignIn />)

    const google = screen.getByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', GOOGLE_OAUTH_PATH)
    const divider = screen.getByText('or')
    // The spec's order: the email form, then "or", then the providers.
    expect(divider.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Only configured providers: the block's Apple button is not drawn.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('carries the redirect it is given into the start URL', () => {
    render(<SocialSignIn redirect="/tenants/abc" />)

    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?app=apex&redirect=%2Ftenants%2Fabc'
    )
  })

  it('renders no divider and no button when no provider is configured', () => {
    const { container } = render(<SocialSignIn providers={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders exactly the providers it is given', () => {
    render(
      <SocialSignIn
        redirect="/x"
        providers={[
          {
            id: 'github',
            label: 'GitHub',
            hrefFor: (redirect) => `/api/v1/auth/github?to=${redirect ?? ''}`,
            Icon: IconBrandGithub,
          },
        ]}
      />
    )

    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      '/api/v1/auth/github?to=/x'
    )
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })
})
