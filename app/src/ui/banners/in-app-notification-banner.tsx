import * as React from 'react'
import { Banner } from './banner'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'

interface IInAppNotificationBannerProps {
  readonly title: string
  readonly body: string
  readonly onOpenNotification: () => void
  readonly onDismissed: () => void
}

export class InAppNotificationBanner extends React.Component<IInAppNotificationBannerProps> {
  public render() {
    return (
      <Banner
        id="in-app-notification-banner"
        onDismissed={this.props.onDismissed}
      >
        <div className="green-circle">
          <Octicon symbol={octicons.bell} />
        </div>
        <div className="banner-message">
          <span>
            <strong>{this.props.title}</strong>
            <br />
            {this.props.body}
          </span>
        </div>
        <Button onClick={this.props.onOpenNotification}>View</Button>
      </Banner>
    )
  }
}
