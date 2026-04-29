import React from 'react'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { Octicon, syncClockwise } from '../octicons'
import { showContextualMenu, IMenuItem } from '../../lib/menu-item'
import { PullButtonDefaultAction } from '../../lib/app-state'
import {
  DropdownItem,
  DropdownItemClassName,
  DropdownItemType,
  forcePushIcon,
} from './push-pull-button'

interface IPushPullButtonDropDownProps {
  readonly itemTypes: ReadonlyArray<DropdownItemType>
  /** The name of the remote. */
  readonly remoteName: string | null

  /** Will the app prompt the user to confirm a force push? */
  readonly askForConfirmationOnForcePush: boolean

  /**
   * Current default action assigned to the main button click. Used to render
   * the checked state in the right-click context menu.
   */
  readonly pullButtonDefaultAction: PullButtonDefaultAction

  readonly fetch: () => void
  readonly forcePushWithLease: () => void
  readonly pullWithRebase: () => void
  readonly pullWithMerge: () => void

  /**
   * Set the default click action for the main button. Triggered from the
   * right-click context menu on a fetch/pull-strategy item.
   */
  readonly onSetPullButtonDefaultAction: (
    action: PullButtonDefaultAction
  ) => void

  /** Open the Pull behavior section of the Preferences dialog. */
  readonly onOpenPreferences: () => void
}

/**
 * Map a dropdown item type to the corresponding default-action preference, or
 * `null` for items that can't be set as the main button's default click.
 * Fetch is excluded because it's already what the button does when there's
 * nothing to pull, and force push is too dangerous to bind as the default.
 */
function dropdownItemAsDefaultAction(
  type: DropdownItemType
): PullButtonDefaultAction | null {
  switch (type) {
    case DropdownItemType.PullWithMerge:
      return 'pull-merge'
    case DropdownItemType.PullWithRebase:
      return 'pull-rebase'
    case DropdownItemType.Fetch:
    case DropdownItemType.ForcePush:
      return null
  }
}

export class PushPullButtonDropDown extends React.Component<IPushPullButtonDropDownProps> {
  private buttonsContainerRef: HTMLDivElement | null = null

  public componentDidMount() {
    window.addEventListener('keydown', this.onDropdownKeyDown)
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.onDropdownKeyDown)
  }

  private onButtonsContainerRef = (ref: HTMLDivElement | null) => {
    this.buttonsContainerRef = ref
  }

  private onDropdownKeyDown = (event: KeyboardEvent) => {
    // Allow using Up and Down arrow keys to navigate the dropdown items
    // (equivalent to Tab and Shift+Tab)
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const items = this.buttonsContainerRef?.querySelectorAll<HTMLElement>(
      `.${DropdownItemClassName}`
    )

    if (items === undefined) {
      return
    }

    const focusedItem =
      this.buttonsContainerRef?.querySelector<HTMLElement>(':focus')
    if (!focusedItem) {
      return
    }

    const focusedIndex = Array.from(items).indexOf(focusedItem)
    const nextIndex =
      event.key === 'ArrowDown' ? focusedIndex + 1 : focusedIndex - 1
    // http://javascript.about.com/od/problemsolving/a/modulobug.htm
    const nextItem = items[(nextIndex + items.length) % items.length]
    nextItem?.focus()
  }

  private getDropdownItemWithType(type: DropdownItemType): DropdownItem {
    const { remoteName } = this.props

    switch (type) {
      case DropdownItemType.Fetch:
        return {
          title: `Fetch ${remoteName}`,
          description: `Fetch the latest changes from ${remoteName}`,
          action: this.props.fetch,
          icon: syncClockwise,
        }
      case DropdownItemType.ForcePush: {
        const forcePushWarning = this.props
          .askForConfirmationOnForcePush ? null : (
          <div className="warning">
            <span className="warning-title">Warning:</span> A force push will
            rewrite history on the remote. Any collaborators working on this
            branch will need to reset their own local branch to match the
            history of the remote.
          </div>
        )
        return {
          title: `Force push ${remoteName}`,
          description: (
            <>
              Overwrite any changes on {remoteName} with your local changes
              {forcePushWarning}
            </>
          ),
          action: this.props.forcePushWithLease,
          icon: forcePushIcon,
        }
      }
      case DropdownItemType.PullWithRebase:
        return {
          title: `Pull ${remoteName} with rebase`,
          description: `Replay your local commits on top of ${remoteName} for a linear history`,
          action: this.props.pullWithRebase,
          icon: octicons.history,
        }
      case DropdownItemType.PullWithMerge:
        return {
          title: `Pull ${remoteName}`,
          description: `Merge changes from ${remoteName} into your local branch`,
          action: this.props.pullWithMerge,
          icon: octicons.gitMerge,
        }
    }
  }

  private onItemContextMenu =
    (type: DropdownItemType) =>
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()

      const items: IMenuItem[] = []
      const asDefault = dropdownItemAsDefaultAction(type)

      if (asDefault !== null) {
        const isAlreadyDefault =
          this.props.pullButtonDefaultAction === asDefault
        items.push({
          label: 'Set as default action',
          type: 'checkbox',
          checked: isAlreadyDefault,
          enabled: !isAlreadyDefault,
          action: () => this.props.onSetPullButtonDefaultAction(asDefault),
        })
        items.push({ type: 'separator' })
      }

      items.push({
        label: 'Pull behavior preferences…',
        action: this.props.onOpenPreferences,
      })

      showContextualMenu(items)
    }

  public renderDropdownItem = (type: DropdownItemType) => {
    const item = this.getDropdownItemWithType(type)
    return (
      <Button
        className={DropdownItemClassName}
        key={type}
        onClick={item.action}
        onContextMenu={this.onItemContextMenu(type)}
      >
        <Octicon symbol={item.icon} />
        <div className="text-container">
          <div className="title">{item.title}</div>
          <div className="detail">{item.description}</div>
        </div>
      </Button>
    )
  }

  public render() {
    const { itemTypes } = this.props
    return (
      <div className="push-pull-dropdown" ref={this.onButtonsContainerRef}>
        {itemTypes.map(this.renderDropdownItem)}
      </div>
    )
  }
}
