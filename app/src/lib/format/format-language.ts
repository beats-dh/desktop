// Tool registry for the auto-format-on-commit feature. Each entry maps a
// language family to the formatter, the file extensions it owns, and the
// config files that signal "this repo wants this formatter to run". The
// repo-config probe is intentional — we only modify files in repos that
// have already opted into a formatter via their own config.
//
// Tools come in two flavors:
//   - `spawn`     — CLI binary that we exec with the file paths as args
//                   (e.g. clang-format). The binary mutates the files in
//                   place; we just wait for exit.
//   - `jsModule`  — JS library exposed by an npm package marked external
//                   in webpack.common. We require it at runtime, call its
//                   format API on each file's contents, and write the
//                   result back ourselves.

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

export interface FormatToolBase {
  /** Stable identifier, used in logs and metrics. */
  readonly id: string
  /** Display name for UI / log messages. */
  readonly displayName: string
  /** Lower-cased extensions (no leading dot) this tool handles. */
  readonly extensions: ReadonlyArray<string>
  /**
   * Lower-cased basenames (no path) the tool also claims, beyond the
   * extension match. Used for files like `Dockerfile`, `Makefile`, etc.
   * that don't carry an extension. Matched case-insensitively.
   */
  readonly filenames?: ReadonlyArray<string>
  /**
   * Shebang interpreters this tool handles (e.g. `bash`, `sh`, `python`).
   * If a file has no extension match and no filename match, we read its
   * first line and check for `#!.../<interpreter>` (with optional `env`).
   * The basename of the interpreter is matched, so `/usr/bin/env bash`
   * and `/bin/bash` both resolve to `bash`.
   */
  readonly shebangs?: ReadonlyArray<string>
  /**
   * File names checked at the repo root that signal the user has configured
   * this formatter for the project. We refuse to format if none are present
   * (so we never apply opinionated defaults to a repo that didn't ask).
   */
  readonly configFiles: ReadonlyArray<string>
}

export interface SpawnFormatTool extends FormatToolBase {
  readonly kind: 'spawn'
  /**
   * Resolve the absolute path to the platform-specific binary at runtime.
   * Returns `null` when the package doesn't ship a binary for the current
   * platform/arch, or when the user's system doesn't have it on PATH (for
   * tools we resolve via `which`). Async because some tools require an
   * external lookup; results are cached by the runner.
   */
  readonly resolveBin: () => Promise<string | null>
  /** Build the argv passed to the binary, given the files to format. */
  readonly buildArgs: (files: ReadonlyArray<string>) => Array<string>
}

export interface JsModuleFormatTool extends FormatToolBase {
  readonly kind: 'jsModule'
  /**
   * Format a single file in place. Reads, formats, writes back. Returns
   * `true` on success, `false` if the formatter chose to skip the file
   * (e.g. unsupported extension), or throws on hard failure. Implementations
   * `require()` the underlying npm package — webpack leaves these untouched
   * because they're listed in the `externals` array.
   */
  readonly formatFile: (
    filePath: string,
    repoPath: string
  ) => Promise<boolean>
}

export type FormatTool = SpawnFormatTool | JsModuleFormatTool

async function resolveClangFormatBin(): Promise<string | null> {
  try {
    // `clang-format-node` ships a `clangFormatPath` constant pointing at the
    // platform-appropriate binary it installed via post-install. Tracks the
    // latest LLVM release weekly via GitHub Actions.
    const mod = require('clang-format-node') as { clangFormatPath?: string }
    return mod.clangFormatPath ?? null
  } catch {
    return null
  }
}

/** Folder name we use for vendored format-tool binaries (per platform-arch). */
function vendorPlatformDir(): string | null {
  const arch = process.arch
  if (process.platform === 'win32' && arch === 'x64') return 'win32-x64'
  if (process.platform === 'win32' && arch === 'arm64') return 'win32-arm64'
  if (process.platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (process.platform === 'linux' && arch === 'arm') return 'linux-armv7l'
  if (process.platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (process.platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  return null
}

/**
 * Resolve a vendored format-tool binary that we download in `post-install`
 * and bundle under `vendor/format-tools/<platform-arch>/<name>` inside the
 * packaged app. `process.resourcesPath` is set by Electron and points at
 * the `resources/` folder of the running app, both in the dev-packaged
 * build (`yarn start`) and in production installers.
 */
function resolveVendoredBin(name: string): string | null {
  const platDir = vendorPlatformDir()
  if (platDir === null) return null
  const ext = process.platform === 'win32' ? '.exe' : ''
  const resPath = (process as NodeJS.Process).resourcesPath
  if (!resPath) return null
  return join(resPath, 'app', 'vendor', 'format-tools', platDir, name + ext)
}

let cachedWhich: typeof import('which') | null = null
async function resolveSystemBin(name: string): Promise<string | null> {
  try {
    if (cachedWhich === null) {
      cachedWhich = require('which') as typeof import('which')
    }
    return await cachedWhich(name, { nothrow: true })
  } catch {
    return null
  }
}

async function resolveShfmtBin(): Promise<string | null> {
  return resolveVendoredBin('shfmt')
}

async function resolveRuffBin(): Promise<string | null> {
  return resolveVendoredBin('ruff')
}

async function resolveRustfmtBin(): Promise<string | null> {
  return resolveSystemBin('rustfmt')
}

async function resolveGofmtBin(): Promise<string | null> {
  return resolveSystemBin('gofmt')
}

async function formatWithPrettier(
  filePath: string,
  _repoPath: string
): Promise<boolean> {
  const prettier = require('prettier') as typeof import('prettier')
  const fileInfo = await prettier.getFileInfo(filePath, {
    resolveConfig: true,
  })
  if (fileInfo.ignored || fileInfo.inferredParser === null) {
    return false
  }
  const config = await prettier.resolveConfig(filePath, {
    editorconfig: true,
  })
  const source = readFileSync(filePath, 'utf8')
  const formatted = await prettier.format(source, {
    ...(config ?? {}),
    filepath: filePath,
  })
  if (formatted !== source) {
    writeFileSync(filePath, formatted, 'utf8')
  }
  return true
}

async function formatWithStylua(
  filePath: string,
  _repoPath: string
): Promise<boolean> {
  // @johnnymorganz/stylua is a WASM library. Its `formatCode` API takes the
  // source string and a config object (NOT raw TOML). We don't ship a TOML
  // parser, so when the repo has a stylua.toml we honor presence-only — the
  // file gets formatted with library defaults. Refining to actually parse
  // stylua.toml is a nice-to-have; defaults match StyLua's own defaults so
  // most projects will be fine.
  const stylua =
    require('@johnnymorganz/stylua') as typeof import('@johnnymorganz/stylua')
  const source = readFileSync(filePath, 'utf8')
  // Cast to `any` because the WASM package's TS types don't always reflect
  // the runtime API and it ships with a few synonymous entry points.
  const formatCode: (code: string, config?: object) => string =
    (stylua as any).formatCode ?? (stylua as any).default?.formatCode
  if (typeof formatCode !== 'function') {
    throw new Error('stylua: no formatCode export')
  }
  const formatted = formatCode(source)
  if (formatted !== source) {
    writeFileSync(filePath, formatted, 'utf8')
  }
  return true
}

export const FORMAT_TOOLS: ReadonlyArray<FormatTool> = [
  {
    kind: 'spawn',
    id: 'clang-format',
    displayName: 'clang-format',
    resolveBin: resolveClangFormatBin,
    extensions: ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh', 'm', 'mm'],
    configFiles: ['.clang-format', '_clang-format'],
    buildArgs: files => ['-i', '--style=file', ...files],
  },
  {
    kind: 'jsModule',
    id: 'prettier',
    displayName: 'Prettier',
    extensions: [
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
      'json', 'jsonc', 'json5',
      'scss', 'css', 'less',
      'html', 'htm',
      'yaml', 'yml',
      'md', 'mdx',
      'xml', 'svg',
      'vue', 'graphql', 'gql',
    ],
    // Prettier honors a wide set of config locations. We keep this list
    // narrow on purpose: the user has explicitly configured Prettier when
    // any of these files exists at the repo root.
    configFiles: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.mjs',
      '.prettierrc.toml',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
    ],
    formatFile: formatWithPrettier,
  },
  {
    kind: 'jsModule',
    id: 'stylua',
    displayName: 'StyLua',
    extensions: ['lua', 'luau'],
    configFiles: ['stylua.toml', '.stylua.toml'],
    formatFile: formatWithStylua,
  },
  {
    kind: 'spawn',
    id: 'shfmt',
    displayName: 'shfmt',
    resolveBin: resolveShfmtBin,
    extensions: ['sh', 'bash', 'zsh', 'bats'],
    // Common extensionless shell scripts in repos. shfmt itself uses the
    // file's first-line shebang to decide what flavor it is, so anything
    // that *looks* like a shell script gets routed here.
    filenames: ['.bashrc', '.zshrc', '.profile', '.bash_profile'],
    shebangs: ['sh', 'bash', 'zsh', 'ksh', 'dash'],
    // shfmt has no native config file — `.editorconfig` is what users
    // typically configure it with, and its presence is the standard
    // opt-in signal across Shell tooling.
    configFiles: ['.editorconfig', '.shfmt'],
    buildArgs: files => ['-w', ...files],
  },
  {
    kind: 'spawn',
    id: 'ruff',
    displayName: 'Ruff',
    resolveBin: resolveRuffBin,
    extensions: ['py', 'pyi'],
    shebangs: ['python', 'python2', 'python3'],
    // Either an explicit ruff config or a pyproject.toml (which ruff also
    // reads, looking for `[tool.ruff]`). We don't validate the section
    // exists — just the file presence — to keep the probe cheap.
    configFiles: ['ruff.toml', '.ruff.toml', 'pyproject.toml'],
    buildArgs: files => ['format', ...files],
  },
  {
    kind: 'spawn',
    id: 'rustfmt',
    displayName: 'rustfmt',
    // No good standalone npm package or single-file binary release; the
    // toolchain is too large to bundle. Detect a system install via PATH
    // — users with Rust set up get formatting for free, others skip.
    // Edition is intentionally NOT pinned via `--edition`: rustfmt picks
    // it up from `Cargo.toml`'s `[package].edition`. Hard-coding 2021
    // would silently rewrite repos on 2018 or 2024 syntax.
    resolveBin: resolveRustfmtBin,
    extensions: ['rs'],
    configFiles: ['rustfmt.toml', '.rustfmt.toml'],
    buildArgs: files => [...files],
  },
  {
    kind: 'spawn',
    id: 'gofmt',
    displayName: 'gofmt',
    // gofmt ships with Go and there's no standalone binary. Same PATH
    // detection story as rustfmt — Go users get it, others don't.
    resolveBin: resolveGofmtBin,
    extensions: ['go'],
    // gofmt has no config file; Go's "one true style" is the convention.
    // We treat the presence of a `go.mod` (Go module marker) as the
    // opt-in signal — the repo is a Go project.
    configFiles: ['go.mod'],
    buildArgs: files => ['-w', ...files],
  },
]

/**
 * Try to identify the formatter for a file by extension first (cheapest),
 * then by basename for known extensionless scripts (`.bashrc`, etc.), and
 * finally by reading the file's first line for a `#!` shebang. Returns
 * `null` when no tool claims the file.
 *
 * `filePath` is expected to be an absolute path so we can read the file
 * for the shebang fallback. Callers that pass a repo-relative path will
 * still get extension/filename matches but skip the shebang probe.
 */
export function getFormatToolForFile(filePath: string): FormatTool | null {
  // 1. Extension match (cheap — pure string scan, no I/O).
  const extMatch = /\.([^./\\]+)$/.exec(filePath)
  if (extMatch) {
    const ext = extMatch[1].toLowerCase()
    const byExt = FORMAT_TOOLS.find(t => t.extensions.includes(ext))
    if (byExt) {
      return byExt
    }
  }

  // 2. Basename match for extensionless files we know about.
  const basename = filePath.replace(/^.*[\\/]/, '').toLowerCase()
  const byName = FORMAT_TOOLS.find(t =>
    t.filenames?.some(name => name.toLowerCase() === basename)
  )
  if (byName) {
    return byName
  }

  // 3. Shebang probe — read just the first line and look for an
  //    interpreter we recognise. Skipped for relative paths and on read
  //    errors (file moved, permission, etc.) so we never crash the
  //    commit flow over a missing optional probe.
  if (FORMAT_TOOLS.some(t => t.shebangs?.length)) {
    const interpreter = readShebangInterpreter(filePath)
    if (interpreter !== null) {
      const byShebang = FORMAT_TOOLS.find(t =>
        t.shebangs?.includes(interpreter)
      )
      if (byShebang) {
        return byShebang
      }
    }
  }

  return null
}

function readShebangInterpreter(filePath: string): string | null {
  try {
    if (!filePath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
      return null
    }
    // 256 bytes is plenty for `#!/usr/bin/env <interpreter> <flags>`.
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(256)
      const read = readSync(fd, buf, 0, 256, 0)
      const head = buf.slice(0, read).toString('utf8').split('\n', 1)[0]
      const m = /^#!\s*(?:\S*\/env\s+)?(\S+)/.exec(head)
      if (m === null) return null
      return m[1].replace(/.*[\\/]/, '').toLowerCase()
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

export function repoHasToolConfig(
  repoPath: string,
  tool: FormatTool
): boolean {
  return tool.configFiles.some(name => existsSync(join(repoPath, name)))
}
