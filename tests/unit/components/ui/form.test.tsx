import { useForm } from '@tanstack/react-form'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'

const VERDICT = 'That role is not yours to grant.'

/**
 * A form with one Base UI Select field, wired the way `form.tsx` tells a page
 * to wire one. `clearsOwnField` is the page's `clearField` call in
 * `onValueChange`; turning it off shows why the call is needed.
 */
function SelectFixture({ clearsOwnField }: { clearsOwnField: boolean }) {
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { role: 'viewer' },
    onSubmit: () => serverErrors.setFieldError('role', [VERDICT]),
  })

  return (
    <Form form={form} serverErrors={serverErrors} aria-label="fixture">
      <FormField form={form} name="role">
        {(field) => (
          <FormItem>
            <FormLabel>Role</FormLabel>
            <Select
              value={fieldValue(field.state.value)}
              onValueChange={(value: string | null) => {
                if (value === null) return
                field.handleChange(value)
                if (clearsOwnField) serverErrors.clearField('role')
              }}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <button type="submit">Save</button>
    </Form>
  )
}

async function pickEditorAfterAVerdict(clearsOwnField: boolean) {
  const user = userEvent.setup()
  render(<SelectFixture clearsOwnField={clearsOwnField} />)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(VERDICT)
  await user.click(screen.getByRole('combobox', { name: 'Role' }))
  await user.click(await screen.findByRole('option', { name: 'Editor' }))
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent(/editor/i)
  )
}

describe('FormControl around a Base UI Select', () => {
  it('points its label at the VISIBLE trigger, not at a hidden input', () => {
    render(<SelectFixture clearsOwnField />)

    const trigger = screen.getByRole('combobox', { name: 'Role' })
    const label = screen.getByText('Role', { selector: 'label' })
    expect(label).toHaveAttribute('for', trigger.id)
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('clears the field’s server error when onValueChange calls clearField', async () => {
    await pickEditorAfterAVerdict(true)

    expect(screen.queryByText(VERDICT)).not.toBeInTheDocument()
  })

  it('keeps the server error without that call, because the selection does not bubble a change to <Form>', async () => {
    await pickEditorAfterAVerdict(false)

    expect(screen.getByText(VERDICT)).toBeInTheDocument()
  })
})
