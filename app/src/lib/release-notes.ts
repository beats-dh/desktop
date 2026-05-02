import { readFile } from 'fs/promises'
import * as Path from 'path'
import * as semver from 'semver'
import {
  ReleaseMetadata,
  ReleaseNote,
  ReleaseSummary,
} from '../models/release-notes'
import { getVersion } from '../ui/lib/app-proxy'
import { formatDate } from './format-date'
import { offsetFromNow } from './offset-from'
import { encodePathAsUrl } from './path'
import { getUserAgent } from './http'

// expects a release note entry to contain a header and then some text
// example:
//    [New] Fallback to Gravatar for loading avatars - #821
const itemEntryRe = /^\[([a-z]{1,})\]\s((.|\n)*)/i

function parseEntry(note: string): ReleaseNote | null {
  const text = note.trim()
  const match = itemEntryRe.exec(text)
  if (match === null) {
    log.debug(`[ReleaseNotes] unable to convert text into entry: ${note}`)
    return null
  }

  const kind = match[1].toLowerCase()
  const message = match[2]
  if (
    kind === 'new' ||
    kind === 'fixed' ||
    kind === 'improved' ||
    kind === 'added' ||
    kind === 'pretext' ||
    kind === 'removed'
  ) {
    return { kind, message }
  }

  log.debug(`[ReleaseNotes] kind ${kind} was found but is not a valid entry`)

  return {
    kind: 'other',
    message,
  }
}

/**
 * A filter function with type predicate to return non-null and non-undefined
 * entries while also satisfying the TS compiler
 *
 * Source: https://stackoverflow.com/a/46700791/1363815
 */
function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

export function parseReleaseEntries(
  notes: ReadonlyArray<string>
): ReadonlyArray<ReleaseNote> {
  return notes.map(n => parseEntry(n)).filter(notEmpty)
}

export function getReleaseSummary(
  latestRelease: ReleaseMetadata
): ReleaseSummary {
  const entries = parseReleaseEntries(latestRelease.notes)

  const enhancements = entries.filter(
    e => e.kind === 'new' || e.kind === 'added' || e.kind === 'improved'
  )
  const bugfixes = entries.filter(e => e.kind === 'fixed')
  const other = entries.filter(e => e.kind === 'removed' || e.kind === 'other')
  const thankYous = entries.filter(e => e.message.includes(' Thanks @'))
  const pretext = entries.filter(e => e.kind === 'pretext')

  return {
    latestVersion: latestRelease.version,
    datePublished: formatDate(new Date(latestRelease.pub_date), {
      time: false,
      dateStyle: 'long',
    }),
    pretext,
    enhancements,
    bugfixes,
    other,
    thankYous,
  }
}

type GitHubRelease = {
  readonly name: string | null
  readonly tag_name: string
  readonly body: string | null
  readonly published_at: string | null
  readonly draft: boolean
  readonly prerelease: boolean
}

// Generated bodies look like:
//
//   ## Fixed
//    - Foo - https://github.com/desktop/desktop/issues/123. Thanks @user!
//
// We invert that back into the `[Type] message` shape that `parseEntry` in
// this file already knows how to render. Markdown outside of recognised
// `## <Type>` sections is ignored.
function parseReleaseBodyToNotes(body: string): ReadonlyArray<string> {
  if (body.length === 0) {
    return []
  }
  const sectionRe = /^##\s+(\w+)\s*$/gm
  const headings = Array.from(body.matchAll(sectionRe))
  const notes: string[] = []
  for (let i = 0; i < headings.length; i++) {
    const m = headings[i]
    const type = m[1]
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length
    const section = body.slice(start, end)
    for (const rawLine of section.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('- ')) {
        notes.push(`[${type}] ${line.slice(2).trim()}`)
      }
    }
  }
  return notes
}

function cleanVersion(tag: string): string {
  // Releases tagged `vX.Y.Z` (the canonical scheme) and the legacy
  // `release-X.Y.Z[-N]` form both reduce to `X.Y.Z[-N]`.
  return tag.replace(/^v/, '').replace(/^release-/, '')
}

export async function getChangeLog(
  limit?: number
): Promise<ReadonlyArray<ReleaseMetadata>> {
  const url = new URL('https://api.github.com/repos/beats-dh/desktop/releases')
  // GitHub caps `per_page` at 100 — fine for "What's new" callers (default
  // 30) and the contributor-thank-you sweep that asks for 250 (it'll just
  // get the most recent 100).
  url.searchParams.set('per_page', String(Math.min(limit ?? 30, 100)))

  // Network errors, DNS failures, malformed JSON, and rate-limit responses
  // (which return a JSON object, not the expected array) all need to come
  // out as `[]` rather than throwing — the `onUpdateNotAvailable` IPC
  // handler awaits this and a rejected promise leaves the UI stuck on
  // "Checking for updates…".
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'user-agent': getUserAgent(),
        accept: 'application/vnd.github+json',
      },
    })
    if (!response.ok) {
      return []
    }
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) {
      return []
    }
    const releases = payload as ReadonlyArray<GitHubRelease>
    const includePrereleases =
      __RELEASE_CHANNEL__ === 'beta' || __RELEASE_CHANNEL__ === 'test'

    return releases
      .filter(r => !r.draft && (includePrereleases || !r.prerelease))
      .map<ReleaseMetadata>(r => ({
        name: r.name ?? r.tag_name,
        notes: parseReleaseBodyToNotes(r.body ?? ''),
        pub_date: r.published_at ?? new Date(0).toISOString(),
        version: cleanVersion(r.tag_name),
      }))
  } catch (e) {
    log.error('[ReleaseNotes] failed to fetch changelog from GitHub', e)
    return []
  }
}

export async function generateReleaseSummary(
  version?: string
): Promise<ReadonlyArray<ReleaseSummary>> {
  const lastTenReleases = await getChangeLog()
  // `getChangeLog` can legitimately return an empty array — the GitHub API
  // is rate-limited (60 req/hr/IP for anonymous calls), the network can be
  // down, or the repo could simply have no releases yet. Bail early so we
  // don't dereference `lastTenReleases[0]` below; the upstream code path
  // never hit this because central.github.com always returned something.
  if (lastTenReleases.length === 0) {
    return []
  }
  const currentVersion = new semver.SemVer(version ?? getVersion())
  const recentReleases = lastTenReleases.filter(
    r =>
      semver.gt(new semver.SemVer(r.version), currentVersion) &&
      new Date(r.pub_date).getTime() > offsetFromNow(-90, 'days')
  )

  // We should only be pulling release notes when a release just happened, so
  // there should be one within the past 90 days. Thus, this is just precaution
  // to ensure we always show at least the last set of release notes.
  return recentReleases.length > 0
    ? recentReleases.map(getReleaseSummary)
    : [getReleaseSummary(lastTenReleases[0])]
}

/**
 * This method is used in conjunction with the Help > Show Popup > Release notes
 * menu item to test release notes on dev builds.
 **/
export async function generateDevReleaseSummary(): Promise<
  ReadonlyArray<ReleaseSummary>
> {
  // Remove version if want to use latest version in your dev build
  const releases = [...(await generateReleaseSummary('3.0.0'))]

  const pretextDraft = await readFile(
    Path.join(__dirname, 'static', 'pretext-draft.md'),
    'utf8'
  ).catch(_ => null)

  if (pretextDraft === null || releases.length === 0) {
    return releases
  }

  return [
    {
      ...releases[0],
      pretext: [{ kind: 'pretext', message: pretextDraft }],
    },
    ...releases.slice(1),
  ]
}

export const ReleaseNoteHeaderLeftUri = encodePathAsUrl(
  __dirname,
  'static/release-note-header-left.svg'
)
export const ReleaseNoteHeaderRightUri = encodePathAsUrl(
  __dirname,
  'static/release-note-header-right.svg'
)
