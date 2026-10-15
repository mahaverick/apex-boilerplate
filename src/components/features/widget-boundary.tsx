import { IconAlertCircle } from '@tabler/icons-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, AlertTitle } from '@/components/ui/alert'

/** The widget's name and its content. */
interface WidgetBoundaryProps {
  /** The widget's name, as the reader knows it: "Sign-ups". */
  name: string
  children: ReactNode
}

/**
 * One widget's render error stays in that widget, so a chart that throws
 * never blanks the Overview. Data errors are the query's to show; this only
 * catches what rendering throws.
 */
export class WidgetBoundary extends Component<WidgetBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  /** Switches to the failure message on the next render. */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  /** Logs the error and the component stack, naming the widget. */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[widget] ${this.props.name}`, error, info.componentStack)
  }

  /** The widget, or a short alert in its place once it has failed. */
  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden="true" />
          <AlertTitle>{this.props.name} could not be shown.</AlertTitle>
        </Alert>
      )
    }
    return this.props.children
  }
}
