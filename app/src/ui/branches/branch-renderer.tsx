import * as React from 'react'

import { Branch } from '../../models/branch'
import { Repository } from '../../models/repository'
import { AheadBehindStore } from '../../lib/stores/ahead-behind-store'

import { IBranchListItem } from './group-branches'
import { BranchListItem } from './branch-list-item'
import { IMatches } from '../../lib/fuzzy-find'
import { getRelativeTimeInfoFromDate } from '../relative-time'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'

/**
 * Renders one row of a branch list. The trailing `repository` /
 * `aheadBehindStore` / `upstreamShaByBranchName` triple is OPTIONAL — pass
 * it from contexts where the unpushed/behind indicator should appear
 * (toolbar branch dropdown). Dialog pickers (rebase/cherry-pick target
 * picker, branch-select widget) can omit them and the row renders with no
 * push-status decoration.
 */
export function renderDefaultBranch(
  item: IBranchListItem,
  matches: IMatches,
  currentBranch: Branch | null,
  authorDate: Date | undefined,
  onDropOntoBranch?: (branchName: string) => void,
  onDropOntoCurrentBranch?: () => void,
  repository?: Repository,
  aheadBehindStore?: AheadBehindStore,
  upstreamShaByBranchName?: ReadonlyMap<string, string>
): JSX.Element {
  const branch = item.branch
  const currentBranchName = currentBranch ? currentBranch.name : null
  // For branches that DO have an upstream tracking ref, look up that
  // upstream's tip SHA so the list item can subscribe to ahead/behind
  // and tint itself when it has unpushed commits. `undefined` covers two
  // cases handled identically by the item: no upstream at all (purely
  // local branch — already tinted as `unpushed`), and upstream listed but
  // its remote tracking entry hasn't arrived yet (fetch in flight).
  const upstreamSha = upstreamShaByBranchName?.get(branch.name)
  return (
    <BranchListItem
      name={branch.name}
      isCurrentBranch={branch.name === currentBranchName}
      branch={branch}
      repository={repository}
      aheadBehindStore={aheadBehindStore}
      upstreamSha={upstreamSha}
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
