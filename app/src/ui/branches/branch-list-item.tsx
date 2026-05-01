import * as React from 'react'

import { IMatches } from '../../lib/fuzzy-find'

import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { HighlightText } from '../lib/highlight-text'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import { DragType, DropTargetType } from '../../models/drag-drop'
import { RelativeTime } from '../relative-time'
import classNames from 'classnames'
import { TooltippedContent } from '../lib/tooltipped-content'
import { enableAccessibleListToolTips } from '../../lib/feature-flag'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'
import { formatDate } from '../../lib/format-date'
import { Branch, IAheadBehind } from '../../models/branch'
import { Repository } from '../../models/repository'
import { AheadBehindStore } from '../../lib/stores/ahead-behind-store'
import type { Disposable } from 'event-kit'

interface IBranchListItemProps {
  /** The name of the branch */
  readonly name: string

  /**
   * The branch model — kept here so we can subscribe to ahead/behind
   * without forcing every parent to compute it. The `name` prop above is
   * still the source of truth for the rendered label (it's the highlighted
   * version). Optional for callers that just want a plain label-style row
   * (dialog pickers, branch-select widget) and don't care about push
   * status — the indicator stays off in that case.
   */
  readonly branch?: Branch

  /** The repo the branch belongs to. Needed by the AheadBehindStore key.
   * Optional for the same reason as `branch`. */
  readonly repository?: Repository

  /** Shared store that lazily computes ahead/behind between two SHAs.
   * Optional — without it the item paints with no push-status decoration. */
  readonly aheadBehindStore?: AheadBehindStore

  /**
   * Tip SHA of the branch's tracked upstream, when there is one. `undefined`
   * means either the branch has no upstream at all (purely local) or the
   * upstream ref hasn't been fetched yet — both are treated the same here:
   * the item paints itself as "unpushed" because there's nothing on the
   * remote that matches the local tip. Only consulted when the other
   * `branch` / `repository` / `aheadBehindStore` props are also provided.
   */
  readonly upstreamSha?: string

  /** Specifies whether this item is currently selected */
  readonly isCurrentBranch: boolean

  /** The characters in the branch name to highlight */
  readonly matches: IMatches

  readonly authorDate: Date | undefined

  /** When a drag element has landed on a branch that is not current */
  readonly onDropOntoBranch?: (branchName: string) => void

  /** When a drag element has landed on the current branch */
  readonly onDropOntoCurrentBranch?: () => void
}

interface IBranchListItemState {
  /**
   * Whether or not there's currently a draggable item being dragged
   * on top of the branch item. We use this in order to disable pointer
   * events when dragging.
   */
  readonly isDragInProgress: boolean

  /** Cached ahead/behind for the branch's local tip vs upstream tip. Stays
   * `undefined` when the branch has no upstream OR while the AheadBehind
   * subscription is still in flight. */
  readonly aheadBehind?: IAheadBehind
}

/** The branch component. */
export class BranchListItem extends React.Component<
  IBranchListItemProps,
  IBranchListItemState
> {
  private aheadBehindSubscription: Disposable | null = null

  public constructor(props: IBranchListItemProps) {
    super(props)
    this.state = { isDragInProgress: false }
  }

  public componentDidMount() {
    this.subscribeToAheadBehind()
  }

  public componentDidUpdate(prevProps: IBranchListItemProps) {
    // Re-subscribe whenever the comparison endpoints change. Branch tips
    // shift when the user pulls / pushes, and the upstream sha changes
    // after a fetch — both should refresh the ahead/behind paint without
    // needing a full re-render of the parent. Tolerate the dialog-picker
    // call sites where `branch` / `repository` aren't provided.
    if (
      prevProps.branch?.tip.sha !== this.props.branch?.tip.sha ||
      prevProps.upstreamSha !== this.props.upstreamSha ||
      prevProps.repository?.path !== this.props.repository?.path
    ) {
      this.subscribeToAheadBehind()
    }
  }

  public componentWillUnmount() {
    this.unsubscribeFromAheadBehind()
    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitLeaveDropTarget()
    }
  }

  private subscribeToAheadBehind() {
    this.unsubscribeFromAheadBehind()

    const { aheadBehindStore, repository, branch, upstreamSha } = this.props

    // Caller didn't opt into the push-status indicator (dialog pickers,
    // branch-select widget). Skip the subscription entirely — the row
    // renders as a plain label.
    if (
      aheadBehindStore === undefined ||
      repository === undefined ||
      branch === undefined
    ) {
      this.setState({ aheadBehind: undefined })
      return
    }

    // No upstream → no ahead/behind to compute. Visual state is driven by
    // `isUnpushed()` directly.
    if (upstreamSha === undefined) {
      this.setState({ aheadBehind: undefined })
      return
    }

    // Try the cache first so we paint correctly on first render when the
    // user re-opens the dropdown for a repo we've already computed.
    const cached = aheadBehindStore.tryGetAheadBehind(
      repository,
      branch.tip.sha,
      upstreamSha
    )
    if (cached !== undefined) {
      this.setState({ aheadBehind: cached })
      return
    }

    this.setState({ aheadBehind: undefined })
    this.aheadBehindSubscription = aheadBehindStore.getAheadBehind(
      repository,
      branch.tip.sha,
      upstreamSha,
      aheadBehind => this.setState({ aheadBehind })
    )
  }

  private unsubscribeFromAheadBehind() {
    if (this.aheadBehindSubscription !== null) {
      this.aheadBehindSubscription.dispose()
      this.aheadBehindSubscription = null
    }
  }

  /**
   * The branch needs the "you have something to publish" tint when there
   * are commits on local that aren't on the remote. Two cases:
   *   1. No upstream at all (`upstreamSha === undefined`) — every commit
   *      is unpushed by definition.
   *   2. Upstream exists and we've computed `ahead > 0`.
   * When `behind > 0` but `ahead === 0` the branch is purely behind
   * upstream — no local work to lose, just needs a pull. That case is
   * handled by `isOnlyBehind()` and shows a subtle down-arrow icon
   * without the tint.
   */
  private isUnpushed(): boolean {
    // Feature opt-in: callers without the ahead/behind plumbing get no
    // decoration, period. Avoids painting every dialog-picker entry as
    // "unpushed" just because we don't know better.
    const { aheadBehindStore, repository, branch, upstreamSha } = this.props
    if (
      aheadBehindStore === undefined ||
      repository === undefined ||
      branch === undefined
    ) {
      return false
    }
    const { aheadBehind } = this.state
    if (upstreamSha === undefined) {
      return true
    }
    return aheadBehind !== undefined && aheadBehind.ahead > 0
  }

  private isOnlyBehind(): boolean {
    const { aheadBehind } = this.state
    return (
      aheadBehind !== undefined &&
      aheadBehind.ahead === 0 &&
      aheadBehind.behind > 0
    )
  }

  private onMouseEnter = () => {
    if (dragAndDropManager.isDragInProgress) {
      this.setState({ isDragInProgress: true })
    }

    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitEnterDropTarget({
        type: DropTargetType.Branch,
        branchName: this.props.name,
      })
    }
  }

  private onMouseLeave = () => {
    this.setState({ isDragInProgress: false })

    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitLeaveDropTarget()
    }
  }

  private onMouseUp = () => {
    const { onDropOntoBranch, onDropOntoCurrentBranch, name, isCurrentBranch } =
      this.props

    this.setState({ isDragInProgress: false })

    if (!dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      return
    }

    if (onDropOntoBranch !== undefined && !isCurrentBranch) {
      onDropOntoBranch(name)
    }

    if (onDropOntoCurrentBranch !== undefined && isCurrentBranch) {
      onDropOntoCurrentBranch()
    }
  }

  public render() {
    const { authorDate, isCurrentBranch, name } = this.props

    const isUnpushed = this.isUnpushed()
    const isOnlyBehind = this.isOnlyBehind()

    const icon = isCurrentBranch ? octicons.check : octicons.gitBranch
    const className = classNames('branches-list-item', {
      'drop-target': this.state.isDragInProgress,
      unpushed: isUnpushed,
      'only-behind': !isUnpushed && isOnlyBehind,
    })

    // Tooltip rule: surface push status whenever it's interesting (unpushed
    // or behind), otherwise fall back to overflow-only behaviour for the
    // branch name. Reuses the branch name as the visible tooltip body.
    const nameTooltip = isUnpushed
      ? `${name} — not pushed to remote`
      : isOnlyBehind
        ? `${name} — behind remote, pull to update`
        : name
    const onlyWhenOverflowed = !isUnpushed && !isOnlyBehind

    return (
      /**
       * This a11y linter is a false-positive as the element is a drop target
       * facilitating our drag and drop functionality for cherry-picking.
       */
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className={className}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        onMouseUp={this.onMouseUp}
      >
        <Octicon className="icon" symbol={icon} />
        <TooltippedContent
          className="name"
          tooltip={nameTooltip}
          onlyWhenOverflowed={onlyWhenOverflowed}
          tagName="div"
          disabled={enableAccessibleListToolTips()}
        >
          <HighlightText text={name} highlight={this.props.matches.title} />
        </TooltippedContent>
        {authorDate &&
          (getPreferAbsoluteDates() ? (
            <span className="description">{formatDate(authorDate)}</span>
          ) : (
            <RelativeTime
              className="description"
              date={authorDate}
              onlyRelative={true}
              tooltip={!enableAccessibleListToolTips()}
            />
          ))}
        {isOnlyBehind && (
          <Octicon className="behind-indicator" symbol={octicons.arrowDown} />
        )}
      </div>
    )
  }
}
