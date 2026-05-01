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

interface IBranchListItemProps {
  /** The name of the branch */
  readonly name: string

  /** Specifies whether this item is currently selected */
  readonly isCurrentBranch: boolean

  /**
   * `true` when the branch has no upstream tracking ref — i.e. it was
   * created locally and never pushed to a remote, so every commit on it
   * is unpushed. The list item picks up an `unpushed` modifier class to
   * surface that state visually (color + tooltip), prompting the user to
   * push before they lose the work.
   */
  readonly isUnpushed: boolean

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
}

/** The branch component. */
export class BranchListItem extends React.Component<
  IBranchListItemProps,
  IBranchListItemState
> {
  public constructor(props: IBranchListItemProps) {
    super(props)
    this.state = { isDragInProgress: false }
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
    const { authorDate, isCurrentBranch, isUnpushed, name } = this.props

    const icon = isCurrentBranch ? octicons.check : octicons.gitBranch
    const className = classNames('branches-list-item', {
      'drop-target': this.state.isDragInProgress,
      unpushed: isUnpushed,
    })
    // Hover/focus tooltip on the row's name. We piggy-back on the existing
    // overflow tooltip when the branch has an upstream; for unpushed
    // branches we always surface the warning, even on short names where
    // overflow isn't triggering.
    const nameTooltip = isUnpushed ? `${name} — not pushed to remote` : name

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
          onlyWhenOverflowed={!isUnpushed}
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
      </div>
    )
  }
}
