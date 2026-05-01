import * as React from 'react'

import { Branch } from '../../models/branch'

import { IBranchListItem } from './group-branches'
import { BranchListItem } from './branch-list-item'
import { IMatches } from '../../lib/fuzzy-find'
import { getRelativeTimeInfoFromDate } from '../relative-time'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'

export function renderDefaultBranch(
  item: IBranchListItem,
  matches: IMatches,
  currentBranch: Branch | null,
  authorDate: Date | undefined,
  onDropOntoBranch?: (branchName: string) => void,
  onDropOntoCurrentBranch?: () => void
): JSX.Element {
  const branch = item.branch
  const currentBranchName = currentBranch ? currentBranch.name : null
  // A local branch with no upstream tracking ref hasn't been pushed yet —
  // every commit on it is unpushed. The list item gets a colored modifier
  // class (see _branches.scss .branches-list-item.unpushed). Only applies
  // to local branches; remote-tracking entries (`origin/foo`) always have
  // upstream === null in this model but are filtered out before reaching
  // this renderer, so the check is safe here.
  const isUnpushed = branch.upstream === null
  return (
    <BranchListItem
      name={branch.name}
      isCurrentBranch={branch.name === currentBranchName}
      isUnpushed={isUnpushed}
      authorDate={authorDate}
      matches={matches}
      onDropOntoBranch={onDropOntoBranch}
      onDropOntoCurrentBranch={onDropOntoCurrentBranch}
    />
  )
}

export function getDefaultAriaLabelForBranch(
  item: IBranchListItem,
  authorDate: Date | undefined
): string {
  const branch = item.branch

  if (!authorDate) {
    return branch.name
  }

  const { relativeText, absoluteText } = getRelativeTimeInfoFromDate(
    authorDate,
    true
  )

  return `${item.branch.name} ${
    getPreferAbsoluteDates() ? absoluteText : relativeText
  }`
}
