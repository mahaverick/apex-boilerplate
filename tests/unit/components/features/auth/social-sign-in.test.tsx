import { IconBrandGithub } from '@tabler/icons-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'

describe('SocialSignIn', () => {
  it('renders Google as a link to the OAuth start route, then the divider', () => {
    render(<SocialSignIn />)

    const google = screen.getByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', GOOGLE_OAUTH_PATH)
    const divider = screen.getByText('Or continue with')
    // login-03 order: the buttons, then the divider above the email form.
    expect(google.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Only configured providers: the block's Apple button is not drawn.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders no divider and no button when no provider is configured', () => {
    const { container } = render(<SocialSignIn providers={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders exactly the providers it is given', () => {
    render(
      <SocialSignIn
        providers={[
          { id: 'github', label: 'GitHub', href: '/api/v1/auth/github', Icon: IconBrandGithub },
        ]}
      />
    )

    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      '/api/v1/auth/github'
    )
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })
})
