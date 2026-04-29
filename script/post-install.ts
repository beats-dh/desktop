#!/usr/bin/env ts-node

import * as Path from 'path'
import { spawnSync, SpawnSyncOptions } from 'child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'

import glob from 'glob'
import { forceUnwrap } from '../app/src/lib/fatal-error'
import { downloadFormatTools } from './format-tools-download'

const root = Path.dirname(__dirname)

const options: SpawnSyncOptions = {
  cwd: root,
  stdio: 'inherit',
}

const captureOutputOptions: SpawnSyncOptions = {
  cwd: root,
  encoding: 'utf8',
}

// Some Windows CI runners do not expose an `npx` executable on PATH, so
// invoke the locally installed Playwright CLI through the current Node binary.
// Resolve from the exported package root since `playwright/cli` is not exported.
const playwrightPackagePath = require.resolve('playwright/package.json')
const playwrightCliPath = Path.join(
  Path.dirname(playwrightPackagePath),
  'cli.js'
)

/** Check if the caller has set the OFFLINE environment variable */
function isOffline() {
  return process.env.OFFLINE === '1'
}

/** Format the arguments to ensure these work offline */
function getYarnArgs(baseArgs: Array<string>): Array<string> {
  const args = baseArgs

  if (isOffline()) {
    args.splice(1, 0, '--offline')
  }

  return args
}

function findYarnVersion(callback: (path: string) => void) {
  glob('vendor/yarn-*.js', (error, files) => {
    if (error != null) {
      throw error
    }

    // this ensures the paths returned by glob are sorted alphabetically
    files.sort()

    // use the latest version here if multiple are found
    callback(forceUnwrap('Missing vendored yarn', files.at(-1)))
  })
}

findYarnVersion(path => {
  const installArgs = getYarnArgs([path, '--cwd', 'app', 'install', '--force'])

  let result = spawnSync('node', installArgs, options)

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  // Point Git at the in-tree hooks directory so the pre-commit auto-formatter
  // is active for everyone who runs `yarn install`. Skipped outside a Git
  // checkout (e.g., source tarball) so the install still succeeds there.
  if (existsSync(Path.join(root, '.git'))) {
    spawnSync('git', ['config', 'core.hooksPath', '.githooks'], options)
  }

  // legal-eagle@0.16.0 calls `readFileSync` on any node_modules child whose
  // name matches /(licen[sc]e|copying)/i — including DIRECTORIES (e.g.
  // `@xml-tools/parser/LICENSES`). That throws EISDIR and aborts the
  // production build. Patch the package's `readIfExists` to skip non-files.
  // Idempotent — guarded by a sentinel comment so re-running yarn install
  // doesn't double-patch.
  patchLegalEagle()

  // Download per-platform format-tool binaries (shfmt, ruff) into
  // `app/vendor/format-tools/<plat>-<arch>/`. Bundled by `script/build.ts`
  // into the packaged app. Network failure here is non-fatal — the
  // auto-format feature degrades to "skipped" for those tools at runtime.
  downloadFormatTools(root).catch(err => {
    console.warn('[post-install] format-tools download failed:', err.message)
  })

  if (!isOffline()) {
    result = spawnSync(
      'git',
      ['submodule', 'update', '--recursive', '--init'],
      options
    )

    if (result.status !== 0) {
      process.exit(result.status || 1)
    }
  }

  result = spawnSync('node', getYarnArgs([path, 'compile:script']), options)

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }

  // Yarn 1 silently skips install scripts for `file:` deps that point to a
  // directory inside the project (vendor/printenvz), so the native binary
  // never gets built. Force a rebuild via npm if the expected output is
  // missing. This must run before script/build.ts which copies the binary
  // into the AppImage / .deb / .rpm.
  const printenvzBinary = Path.join(
    root,
    'node_modules/printenvz/build/Release',
    process.platform === 'win32' ? 'printenvz.exe' : 'printenvz'
  )
  if (!existsSync(printenvzBinary)) {
    console.log('printenvz binary missing, forcing rebuild via npm…')
    result = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['rebuild', 'printenvz'],
      options
    )
    if (result.status !== 0) {
      process.exit(result.status || 1)
    }
  }

  // Linux-specific: apply patches from the patches/ directory
  if (process.platform === 'linux') {
    const patchesDir = Path.join(root, 'patches')
    if (existsSync(patchesDir)) {
      const patches = readdirSync(patchesDir).filter(f => f.endsWith('.patch'))
      for (const patch of patches) {
        const patchPath = Path.join(patchesDir, patch)
        result = spawnSync(
          'patch',
          ['-p1', '--forward', '--force', '--input', patchPath],
          {
            ...options,
            cwd: root,
          }
        )
        if (result.status !== 0 && result.status !== 1) {
          // status 1 means already applied (idempotent), only fail on other errors
          console.warn(
            `Warning: patch ${patch} may have failed (status ${result.status})`
          )
        }
      }
    }
  }

  // Capture output here so CI failures include the Playwright-specific error.
  result = spawnSync(
    process.execPath,
    [playwrightCliPath, 'install', 'ffmpeg'],
    captureOutputOptions
  )

  if (result.status !== 0) {
    console.error(
      'Error: failed to install Playwright ffmpeg (video recording may not work)',
      '\nplatform:',
      process.platform,
      '\nstatus:',
      result.status,
      '\nsignal:',
      result.signal,
      '\nerror:',
      result.error,
      '\nstdout:',
      result.stdout,
      '\nstderr:',
      result.stderr
    )
  }
})

function patchLegalEagle() {
  const legalEaglePath = Path.join(
    root,
    'node_modules/legal-eagle/lib/legal-eagle.js'
  )
  if (!existsSync(legalEaglePath)) {
    return
  }

  // Each patch step is independently idempotent — its replacement looks
  // for the original text and rewrites it. Once applied, the original
  // text is gone, so re-running just no-ops on each step.
  let content = readFileSync(legalEaglePath, 'utf8')
  const before = content

  // Step 1: add `statSync` to the destructured `fs` import.
  content = content.replace(
    "_ref2 = require('fs'), existsSync = _ref2.existsSync, readdirSync = _ref2.readdirSync, readFileSync = _ref2.readFileSync;",
    "_ref2 = require('fs'), existsSync = _ref2.existsSync, readdirSync = _ref2.readdirSync, readFileSync = _ref2.readFileSync, statSync = _ref2.statSync;"
  )

  // Step 2: make `readIfExists` skip directories. A `LICENSES/` folder
  // named like a license file (e.g. `@xml-tools/parser/LICENSES`) would
  // otherwise crash the dep-tree walk with EISDIR.
  content = content.replace(
    "readIfExists = function(path) {\n    if (existsSync(path)) {\n      return readFileSync(path, 'utf8');\n    }\n  };",
    "readIfExists = function(path) {\n    /* desktop-fork-patch: skip-dir */\n    if (existsSync(path) && statSync(path).isFile()) {\n      return readFileSync(path, 'utf8');\n    }\n  };"
  )

  // Step 3: once `readIfExists` can return undefined (it always could in
  // theory, but now happens deterministically for dirs), `licenseFromText
  // (undefined)` crashes with "Cannot read properties of undefined". Guard.
  content = content.replace(
    "licenseFromText = function(licenseText) {\n    if (licenseText.indexOf('Apache License') > -1) {",
    "licenseFromText = function(licenseText) {\n    if (licenseText == null) { return; }\n    if (licenseText.indexOf('Apache License') > -1) {"
  )

  if (content === before) {
    return
  }
  writeFileSync(legalEaglePath, content)
  console.log(
    '[post-install] legal-eagle patched (readIfExists guards dirs, licenseFromText guards null)'
  )
}
