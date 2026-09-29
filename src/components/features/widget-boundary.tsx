import { Component, type ErrorInfo, type ReactNode } from 'react'

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

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[widget] ${this.props.name}`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p role="alert" className="rounded-md border p-4 text-sm text-muted-foreground">
          {this.props.name} could not be shown.
        </p>
      )
    }
    return this.props.children
  }
}
