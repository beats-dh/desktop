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
import { Branch, BranchType, IAheadBehind } from '../../models/branch'
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

  /**
   * Identity key for the (local tip, upstream tip) pair currently reflected
   * in `aheadBehind`. Used by `getDerivedStateFromProps` to detect when the
   * comparison endpoints have shifted and the cached value (if any) needs
   * to be re-read from the store. Without this we'd either keep stale data
   * across prop changes or lose the synchronous cache hit that prevents
   * the orange-paint flash.
   */
  readonly aheadBehindKey: string
}

/** The branch component. */
export class BranchListItem extends React.Component<
  IBranchListItemProps,
  IBranchListItemState
> {
  /**
   * Pre-render hook that keeps `aheadBehind` in sync with the current
   * comparison endpoints. The flash we're avoiding here happens on the
   * second mount cycle: a parent prop change (typically `upstreamSha`
   * going from undefined → real SHA after the remote-tip fetch resolves)
   * arrives, React renders with the OLD `aheadBehind` value, and only
   * then `componentDidUpdate` fires and re-subscribes. Reading the cache
   * here lets us update the state ALONGSIDE the prop change, in the same
   * render pass, so a cached hit is reflected immediately instead of one
   * frame later.
   *
   * Returns `null` when nothing changed, which keeps React's bailout path
   * intact for the common case (drag state changes, parent re-renders
   * without endpoint changes, etc.).
   */
  public static getDerivedStateFromProps(
    props: IBranchListItemProps,
    state: IBranchListItemState
  ): Partial<IBranchListItemState> | null {
    const key = BranchListItem.computeAheadBehindKey(props)
    if (key === state.aheadBehindKey) {
      return null
    }
    return {
      aheadBehind: BranchListItem.tryReadCachedAheadBehind(props),
      aheadBehindKey: key,
    }
  }

  private static tryReadCachedAheadBehind(
    props: IBranchListItemProps
  ): IAheadBehind | undefined {
    const { aheadBehindStore, repository, branch, upstreamSha } = props
    if (
      aheadBehindStore === undefined ||
      repository === undefined ||
      branch === undefined ||
      upstreamSha === undefined
    ) {
      return undefined
    }
    return aheadBehindStore.tryGetAheadBehind(
      repository,
      branch.tip.sha,
      upstreamSha
    )
  }

  /**
   * The pair of SHAs that defines what `aheadBehind` is currently caching.
   * When this key changes we know the comparison endpoints shifted and the
   * cached value (if any) needs to be re-read.
   */
  private static computeAheadBehindKey(props: IBranchListItemProps): string {
    return `${props.repository?.path ?? ''}|${props.branch?.tip.sha ?? ''}|${
      props.upstreamSha ?? ''
    }`
  }

  private aheadBehindSubscription: Disposable | null = null

  public constructor(props: IBranchListItemProps) {
    super(props)
    // Seed state synchronously from the AheadBehindStore cache. Anything
    // we can resolve here saves us a paint: without it the first render
    // is always `aheadBehind: undefined` → row paints neutral → cache hit
    // arrives in `componentDidMount` → row repaints orange.
    this.state = {
      isDragInProgress: false,
      aheadBehind: BranchListItem.tryReadCachedAheadBehind(props),
      aheadBehindKey: BranchListItem.computeAheadBehindKey(props),
    }
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

    // Cases where there's nothing async to compute. State is already
    // correctly seeded by `getDerivedStateFromProps` (cache lookup or
    // `undefined`), so we just need to skip the subscription.
    if (
      aheadBehindStore === undefined ||
      repository === undefined ||
      branch === undefined ||
      upstreamSha === undefined
    ) {
      return
    }

    // Cache hit was already reflected synchronously in state via
    // `getDerivedStateFromProps`. No subscription needed — the store
    // would just hand us back the same value, and the (sha, sha) pair
    // is immutable so the cached value can't go stale for this key.
    if (this.state.aheadBehind !== undefined) {
      return
    }

    // Cache miss → kick off the async computation. The callback fires
    // when the worker resolves, at which point we update state and
    // trigger the orange repaint for branches that actually have local
    // commits.
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
   *   1. No upstream at all (`branch.upstream === null`) — every commit
   *      is unpushed by definition. Decided synchronously from the model
   *      so first paint is correct (no flash).
   *   2. Upstream exists AND we've already resolved `aheadBehind` AND
   *      `ahead > 0`. While the upstream tip / ahead-behind subscription
   *      is still loading we deliberately return `false`: pretending the
   *      branch is unpushed during that window would paint the whole
   *      list orange on every dropdown open and then snap back to normal,
   *      which is exactly the flicker we want to avoid.
   * Branches that are purely behind upstream (no local work to lose,
   * just need a pull) are intentionally NOT decorated — the row stays
   * neutral so the user's eye doesn't get pulled by routine fetch lag.
   */
  private isUnpushed(): boolean {
    // Feature opt-in: callers without the ahead/behind plumbing get no
    // decoration, period. Avoids painting every dialog-picker entry as
    // "unpushed" just because we don't know better.
    const { aheadBehindStore, repository, branch } = this.props
    if (
      aheadBehindStore === undefined ||
      repository === undefined ||
      branch === undefined
    ) {
      return false
    }
    // Remote-tracking branches (`origin/foo`, `upstream/foo`) ARE the
    // remote — they can't have "local modifications not on the web". The
    // indicator only makes sense for local branches.
    if (branch.type !== BranchType.Local) {
      return false
    }
    // Truly local branch (no upstream tracking ref configured). Synchronous
    // signal straight from the model — decide on first render, no flash.
    if (branch.upstream === null) {
      return true
    }
    // Upstream exists. Only paint the warning once the ahead/behind
    // subscription has actually delivered a result. Any other state
    // (subscription pending, upstream sha not yet loaded) is treated as
    // "unknown" → leave the row neutral.
    const { aheadBehind } = this.state
    return aheadBehind !== undefined && aheadBehind.ahead > 0
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

    const icon = isCurrentBranch ? octicons.check : octicons.gitBranch
    const className = classNames('branches-list-item', {
      'drop-target': this.state.isDragInProgress,
      unpushed: isUnpushed,
    })

    // Tooltip rule: surface push status when the branch is unpushed,
    // otherwise fall back to overflow-only behaviour for the branch name.
    const nameTooltip = isUnpushed ? `${name} — not pushed to remote` : name
    const onlyWhenOverflowed = !isUnpushed

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
          // When the unified accessible-tooltips flag is on, the List
          // component handles per-row tooltips via aria-label and per-row
          // TooltippedContents are redundant. We keep ours enabled in the
          // unpushed case anyway, because the suffix ("not pushed to
          // remote") carries information the visual tint + italic alone
          // don't fully convey for sighted users.
          disabled={!isUnpushed && enableAccessibleListToolTips()}
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
      </div>
    )
  }
}
