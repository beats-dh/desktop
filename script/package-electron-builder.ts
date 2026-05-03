/* eslint-disable no-sync */

import * as path from 'path'
import * as cp from 'child_process'
import { promisify } from 'util'

import glob = require('glob')
const globPromise = promisify(glob)

import { getDistPath, getDistRoot } from './dist-info'

function getArchitecture() {
  const arch = process.env.npm_config_arch || process.arch
  switch (arch) {
    case 'arm64':
      return '--arm64'
    case 'arm':
      return '--armv7l'
    default:
      return '--x64'
  }
}

async function runElectronBuilder(): Promise<void> {
  const distPath = getDistPath()

  // Skip the .cmd/.sh shim under `node_modules/.bin/` and run electron-
  // builder's CLI entry point directly with `node`. Cross-platform, no
  // `shell: true` (which trips the DEP0190 warning), no Windows-specific
  // `.cmd` resolution.
  const electronBuilderCli = require.resolve('electron-builder/out/cli/cli')

  const configPath = path.resolve(__dirname, 'electron-builder.yml')

  const args = [
    electronBuilderCli,
    'build',
    '--prepackaged',
    distPath,
    getArchitecture(),
    '--config',
    configPath,
    // The `publish:` block in electron-builder.yml tells the GitHub
    // provider where to look at runtime, but we don't want electron-
    // builder to upload artefacts itself — the `publish` job in
    // ci-linux.yml owns that. Without `--publish never` electron-builder
    // detects CI, decides to upload, and fails on missing `GH_TOKEN`.
    '--publish',
    'never',
  ]

  const { error, status } = cp.spawnSync(process.execPath, args, {
    stdio: 'inherit',
  })

  if (error != null) {
    throw error
  }
  if (status !== 0) {
    throw new Error(`electron-builder exited with status ${status}`)
  }
}

// Builds a glob pattern rooted at `distRoot`. `path.join` would be wrong
// here: on Windows it emits backslashes, which `minimatch` (used by
// `glob`) interprets as escape characters rather than path separators —
// the pattern would silently match nothing. Forward slashes work on
// every platform glob runs on.
function distGlob(distRoot: string, pattern: string): string {
  return path.join(distRoot, pattern).split(path.sep).join('/')
}

export async function packageElectronBuilder(): Promise<Array<string>> {
  await runElectronBuilder()

  const distRoot = getDistRoot()
  const appImageInstaller = distGlob(distRoot, 'GitHubDesktop-linux-*.AppImage')

  const files = await globPromise(appImageInstaller)
  if (files.length !== 1) {
    return Promise.reject(
      `Expected one AppImage installer but instead found '${files.join(
        ', '
      )}' - exiting...`
    )
  }

  return [files[0]]
}

// Windows packaging via electron-builder produces:
//   - `GitHubDesktopSetup-<arch>-<version>.exe`  (NSIS installer)
//   - `latest.yml`                                (electron-updater manifest)
// plus a few helper files (block maps, etc.) we don't need to surface.
// Both files are required by the release pipeline — the manifest is what
// `electron-updater` clients fetch to discover updates, so failing the
// build here is much louder than failing the publish job later.
export async function packageWindowsElectronBuilder(): Promise<Array<string>> {
  await runElectronBuilder()

  const distRoot = getDistRoot()
  const installerGlob = distGlob(distRoot, 'GitHubDesktopSetup-*.exe')
  const manifestGlob = distGlob(distRoot, 'latest*.yml')

  const installers = await globPromise(installerGlob)
  if (installers.length === 0) {
    return Promise.reject(
      `No NSIS installer found at '${installerGlob}' after electron-builder run.`
    )
  }
  const manifests = await globPromise(manifestGlob)
  if (manifests.length === 0) {
    return Promise.reject(
      `No electron-updater manifest found at '${manifestGlob}' after electron-builder run.`
    )
  }

  return [...installers, ...manifests]
}
