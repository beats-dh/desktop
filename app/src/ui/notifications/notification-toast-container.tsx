import * as React from 'react'
import { NotificationToast } from './notification-toast'
import { INotificationToast } from '../../models/notification-toast'

interface INotificationToastContainerProps {
  readonly toasts: ReadonlyArray<INotificationToast>
  readonly onDismiss: (id: string) => void
}

/**
 * Fixed-position stack rendered at the app root. Renders nothing when there
 * are no toasts so it doesn't interfere with focus or pointer events on the
 * window content.
 */
export class NotificationToastContainer extends React.Component<INotificationToastContainerProps> {
  public render() {
    const { toasts } = this.props
    if (toasts.length === 0) {
      return null
    }

    return (
      <div className="notification-toast-container">
        {toasts.map(toast => (
          <NotificationToast
            key={toast.id}
            toast={toast}
            onDismiss={this.props.onDismiss}
          />
        ))}
      </div>
    )
  }
}
