#!/usr/bin/env node
// Auto-formats files staged for commit (or all tracked files when --all is
// passed) and re-stages them, so commits always land already formatted.
//
// Routing by extension:
//   .ts .tsx .js .jsx .json .scss .html .yaml .yml .md → prettier
//   .ts .tsx .js .jsx                                  → eslint --fix
//   .cpp .cc .cxx .c .h .hpp .hh                       → clang-format-node
//
// Bypass with `SKIP_FORMAT=1 git commit ...`. Tools whose binaries are not
// installed are skipped with a warning rather than blocking the commit, so a
// fresh clone that hasn't run `yarn install` yet can still commit.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.SKIP_FORMAT === '1') {
  process.exit(0)
}

const isWin = process.platform === 'win32'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PRETTIER_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'scss', 'html', 'yaml', 'yml', 'md',
])
const ESLINT_EXTS = new Set(['ts', 'tsx', 'js', 'jsx'])
const CLANG_FORMAT_EXTS = new Set(['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh'])

const ESLINT_PATH_PREFIXES = [
  'eslint-rules/',
  'script/',
  'app/src/',
  'app/typings/',
  'app/test/',
]

function getFiles() {
  const all = process.argv.includes('--all')
  const cmd = all
    ? ['ls-files', '-z']
    : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
  const out = execFileSync('git', cmd, { cwd: root, encoding: 'buffer' })
  return out.toString('utf8').split('\0').filter(Boolean)
}

function extOf(file) {
  const m = /\.([^./\\]+)$/.exec(file)
  return m ? m[1].toLowerCase() : ''
}

function localBin(name) {
  const bin = join(root, 'node_modules', '.bin', isWin ? `${name}.cmd` : name)
  return existsSync(bin) ? bin : null
}

function run(label, bin, args) {
  console.log(`[format-staged] ${label}: ${args.length} file(s)`)
  // Windows requires `shell: true` for `.cmd` shims; on POSIX we leave it
  // off so we don't pay a shell-fork cost or risk argv quoting issues.
  const result = spawnSync(bin, args, {
    stdio: 'inherit',
    cwd: root,
    shell: isWin,
  })
  if (result.error) {
    console.error(`[format-staged] ${label} failed:`, result.error.message)
    return 1
  }
  return result.status ?? 1
}

function warnMissing(label, hint) {
  console.warn(`[format-staged] skipping ${label} — binary not found (${hint})`)
}

function isEslintTarget(f) {
  if (f === 'changelog.json') return true
  if (!ESLINT_EXTS.has(extOf(f))) return false
  return ESLINT_PATH_PREFIXES.some(p => f.startsWith(p))
}

const files = getFiles()
if (files.length === 0) process.exit(0)

const buckets = {
  prettier: files.filter(f => PRETTIER_EXTS.has(extOf(f))),
  eslint: files.filter(isEslintTarget),
  clangFormat: files.filter(f => CLANG_FORMAT_EXTS.has(extOf(f))),
}

let exitCode = 0

if (buckets.prettier.length) {
  const bin = localBin('prettier')
  if (bin) {
    const status = run('prettier', bin, ['--write', '--ignore-unknown', ...buckets.prettier])
    if (status !== 0) exitCode = status
  } else {
    warnMissing('prettier', 'run `yarn install`')
  }
}

if (buckets.eslint.length) {
  const bin = localBin('eslint')
  if (bin) {
    const status = run('eslint', bin, [
      '--rulesdir', './eslint-rules',
      '--fix',
      '--no-error-on-unmatched-pattern',
      ...buckets.eslint,
    ])
    if (status !== 0) exitCode = status
  } else {
    warnMissing('eslint', 'run `yarn install`')
  }
}

if (buckets.clangFormat.length) {
  // `clang-format-node` exposes the platform-specific binary path as a
  // top-level export; falls back to the legacy `clang-format` shim if the
  // newer package isn't installed for some reason.
  let clangBin = null
  try {
    const mod = await import('clang-format-node')
    clangBin = mod.clangFormatPath ?? null
  } catch {
    clangBin = localBin('clang-format')
  }
  if (clangBin) {
    const status = run('clang-format', clangBin, ['-i', '--style=file', ...buckets.clangFormat])
    if (status !== 0) exitCode = status
  } else {
    warnMissing('clang-format', 'install `clang-format-node` devDependency or system LLVM')
  }
}

// Re-stage everything that was originally staged so the commit picks up the
// reformatted contents. Skipped on --all (manual run, no commit in flight).
if (!process.argv.includes('--all') && exitCode === 0) {
  const result = spawnSync('git', ['add', '--', ...files], { stdio: 'inherit', cwd: root })
  if (result.status !== 0) {
    console.error('[format-staged] failed to re-stage files')
    exitCode = result.status ?? 1
  }
}

process.exit(exitCode)
