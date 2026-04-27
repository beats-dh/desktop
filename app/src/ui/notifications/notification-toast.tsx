import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { INotificationToast } from '../../models/notification-toast'

interface INotificationToastProps {
  readonly toast: INotificationToast
  readonly onDismiss: (id: string) => void
}

/**
 * A single floating notification toast. Click anywhere on the body invokes
 * the action; the dedicated close button just dismisses. Hovering pauses the
 * auto-dismiss timer that lives in the store.
 */
export class NotificationToast extends React.Component<INotificationToastProps> {
  private onActionClick = () => {
    this.props.toast.onClick()
    this.props.onDismiss(this.props.toast.id)
  }

  private onCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    this.props.onDismiss(this.props.toast.id)
  }

  public render() {
    const { title, body } = this.props.toast
    return (
      <div className="notification-toast">
        <div className="notification-toast-icon">
          <Octicon symbol={octicons.bell} />
        </div>
        <div
          className="notification-toast-body"
          onClick={this.onActionClick}
          role="button"
          tabIndex={0}
        >
          <div className="notification-toast-title">{title}</div>
          <div className="notification-toast-text">{body}</div>
        </div>
        <Button
          className="notification-toast-close"
          ariaLabel="Dismiss notification"
          onClick={this.onCloseClick}
        >
          <Octicon symbol={octicons.x} />
        </Button>
      </div>
    )
  }
}
