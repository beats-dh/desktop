#!/usr/bin/env ts-node

import * as Path from 'path'
import { spawnSync, SpawnSyncOptions } from 'child_process'
import { existsSync } from 'fs'

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

  // Apply patches via patch-package. Cross-platform (uses Node, no
  // dependency on a system `patch` binary) and idempotent.
  //
  // Patches are split across two directories so platform-specific ones don't
  // poison the rest:
  //   - `patches/`        cross-platform; applied on every OS.
  //                       legal-eagle+0.16.0.patch (skip dirs in readIfExists,
  //                       guard nulls in licenseFromText — fixes prod
  //                       license-dump crash on `@xml-tools/parser/LICENSES`).
  //   - `patches-linux/`  Linux-only; the target packages are
  //                       `optionalDependencies` that only resolve on Linux,
  //                       and patch-package errors out on
  //                       "patch file found for package not present" (exit 1)
  //                       even when the user is on Windows/macOS where the
  //                       package legitimately isn't installed.
  //                       electron-installer-redhat+3.4.0.patch (RPM packaging).
  //
  // Invoked via the current Node binary against patch-package's CLI module —
  // the earlier `spawn('npx.cmd', …)` form failed silently on Windows CI
  // because `.cmd` shims don't run via direct CreateProcess.
  const patchPackageCli = require.resolve('patch-package/dist/index.js')
  result = spawnSync(process.execPath, [patchPackageCli], options)
  if (result.status !== 0) {
    console.error(
      `[post-install] patch-package exited with ${result.status} — refusing to continue with unpatched node_modules`
    )
    process.exit(result.status || 1)
  }
  if (process.platform === 'linux') {
    result = spawnSync(
      process.execPath,
      [patchPackageCli, '--patch-dir', 'patches-linux'],
      options
    )
    if (result.status !== 0) {
      console.error(
        `[post-install] patch-package (patches-linux) exited with ${result.status}`
      )
      process.exit(result.status || 1)
    }
  }

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

  // (Patches in patches/ are applied above by patch-package, cross-platform.)

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

