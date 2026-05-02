// Downloads vendored format-tool binaries for the auto-format-on-commit
// feature, one per current platform/arch. Runs from `script/post-install.ts`
// after the main `yarn install`. Idempotent — skips files that already exist.
//
// We download the platform-specific binary on the machine that runs
// `yarn install` and bundle it from `app/vendor/format-tools/<plat-arch>/`.
// CI builds Linux/Windows/macOS on separate runners, so each picks its own
// binary.
//
// Tools fetched here:
//   * shfmt   — github.com/mvdan/sh, single-file binary per platform
//   * ruff    — github.com/astral-sh/ruff, single-file binary per platform
//
// Tools intentionally NOT fetched:
//   * rustfmt — distributed only as part of the full Rust toolchain
//               (~100 MB). We fall back to the user's system install via
//               PATH at runtime instead.
//   * gofmt   — ships with Go; no standalone binary. Same PATH fallback.
//
// We don't pin SHA-256 checksums right now. That's a hardening to-do —
// HTTPS to GitHub is the trust anchor for now.

import { spawnSync } from 'child_process'
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'fs'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'

const SHFMT_VERSION = '3.11.0'
const RUFF_VERSION = '0.7.4'

type BinarySpec = {
  /** URL of the asset to download. */
  readonly url: string
  /**
   * If the asset is an archive (.tar.gz / .zip), the path inside it that
   * the binary lives at. Set to `null` when the asset itself is the
   * binary.
   */
  readonly archiveEntry: string | null
}

type ToolMatrix = Record<string, BinarySpec | null>

/**
 * Resolve the URL + archive layout for a given tool on the current
 * platform/arch combo. Returns `null` for combos we don't support — caller
 * skips them silently.
 */
function shfmtSpec(): BinarySpec | null {
  const matrix: ToolMatrix = {
    'win32-x64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_windows_amd64.exe`,
      archiveEntry: null,
    },
    'win32-arm64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_windows_arm64.exe`,
      archiveEntry: null,
    },
    'linux-x64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_linux_amd64`,
      archiveEntry: null,
    },
    'linux-arm64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_linux_arm64`,
      archiveEntry: null,
    },
    'linux-armv7l': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_linux_arm`,
      archiveEntry: null,
    },
    'darwin-x64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_darwin_amd64`,
      archiveEntry: null,
    },
    'darwin-arm64': {
      url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_darwin_arm64`,
      archiveEntry: null,
    },
  }
  return matrix[currentPlatformArch()] ?? null
}

function ruffSpec(): BinarySpec | null {
  // Ruff ships its release assets as `.tar.gz` (Unix) / `.zip` (Windows).
  // We only support tar.gz extraction here for simplicity; on Windows the
  // .zip case extracts via Node's `node:zlib` cousin which we'd need to
  // pull in. Astral also publishes a `.tar.gz` for Windows now.
  const tag = RUFF_VERSION
  const matrix: ToolMatrix = {
    'win32-x64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-x86_64-pc-windows-msvc.zip`,
      archiveEntry: 'ruff.exe',
    },
    'win32-arm64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-aarch64-pc-windows-msvc.zip`,
      archiveEntry: 'ruff.exe',
    },
    'linux-x64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-x86_64-unknown-linux-gnu.tar.gz`,
      archiveEntry: 'ruff-x86_64-unknown-linux-gnu/ruff',
    },
    'linux-arm64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-aarch64-unknown-linux-gnu.tar.gz`,
      archiveEntry: 'ruff-aarch64-unknown-linux-gnu/ruff',
    },
    'linux-armv7l': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-armv7-unknown-linux-gnueabihf.tar.gz`,
      archiveEntry: 'ruff-armv7-unknown-linux-gnueabihf/ruff',
    },
    'darwin-x64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-x86_64-apple-darwin.tar.gz`,
      archiveEntry: 'ruff-x86_64-apple-darwin/ruff',
    },
    'darwin-arm64': {
      url: `https://github.com/astral-sh/ruff/releases/download/${tag}/ruff-aarch64-apple-darwin.tar.gz`,
      archiveEntry: 'ruff-aarch64-apple-darwin/ruff',
    },
  }
  return matrix[currentPlatformArch()] ?? null
}

function currentPlatformArch(): string {
  return `${process.platform}-${process.arch}`
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(
      `download ${url} failed: ${response.status} ${response.statusText}`
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  const file = createWriteStream(dest)
  await pipeline(response.body as unknown as NodeJS.ReadableStream, file)
}

async function fetchAndPlaceBinary(
  toolName: string,
  spec: BinarySpec | null,
  destDir: string
): Promise<boolean> {
  if (spec === null) {
    console.log(
      `[format-tools] ${toolName}: no prebuilt binary for ${currentPlatformArch()}, skipping`
    )
    return false
  }

  const ext = process.platform === 'win32' ? '.exe' : ''
  const finalPath = join(destDir, `${toolName}${ext}`)
  if (existsSync(finalPath)) {
    return true
  }

  console.log(`[format-tools] downloading ${toolName} from ${spec.url}`)

  if (spec.archiveEntry === null) {
    await downloadToFile(spec.url, finalPath)
  } else {
    // System `tar` handles both `.tar.gz` and `.zip` since Windows 10
    // 1809 (April 2018) and on every supported Linux/macOS shell. Keeps
    // us free of node-side archive deps that would balloon the install.
    const archiveExt = spec.url.endsWith('.zip') ? '.zip' : '.tar.gz'
    const tmpArchive = join(destDir, `${toolName}${archiveExt}.tmp`)
    await downloadToFile(spec.url, tmpArchive)
    const result = spawnSync('tar', ['-xf', tmpArchive, '-C', destDir], {
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      throw new Error(
        `[format-tools] ${toolName}: tar -xf failed (status ${result.status})`
      )
    }
    const extracted = join(destDir, spec.archiveEntry)
    if (!existsSync(extracted)) {
      throw new Error(
        `[format-tools] ${toolName}: archive missing entry ${spec.archiveEntry}`
      )
    }
    renameSync(extracted, finalPath)
    // Some archives nest the binary under a folder — clean it up so we
    // don't leak the unpacked tree alongside the canonical binary.
    const topDir = spec.archiveEntry.split('/')[0]
    if (topDir && topDir !== `${toolName}${ext}`) {
      rmSync(join(destDir, topDir), { recursive: true, force: true })
    }
    rmSync(tmpArchive, { force: true })
  }

  if (process.platform !== 'win32') {
    chmodSync(finalPath, 0o755)
  }
  console.log(`[format-tools] ${toolName} ready at ${finalPath}`)
  return true
}

export async function downloadFormatTools(projectRoot: string): Promise<void> {
  const platDir = currentPlatformArch()
  const destDir = join(projectRoot, 'app', 'vendor', 'format-tools', platDir)

  await fetchAndPlaceBinary('shfmt', shfmtSpec(), destDir).catch(err => {
    console.warn(`[format-tools] shfmt: ${err.message}`)
  })
  await fetchAndPlaceBinary('ruff', ruffSpec(), destDir).catch(err => {
    console.warn(`[format-tools] ruff: ${err.message}`)
  })
}
