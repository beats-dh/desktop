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

  // On Windows the `.bin/electron-builder` shim is a `.cmd` batch file;
  // `spawnSync` won't auto-append the extension, so resolve directly.
  const isWindows = process.platform === 'win32'
  const binName = isWindows ? 'electron-builder.cmd' : 'electron-builder'
  const electronBuilder = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    binName
  )

  const configPath = path.resolve(__dirname, 'electron-builder.yml')

  const args = [
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

  const { error, status } = cp.spawnSync(electronBuilder, args, {
    stdio: 'inherit',
    // `.cmd` shims need a shell on Windows; harmless elsewhere.
    shell: isWindows,
  })

  if (error != null) {
    throw error
  }
  if (status !== 0) {
    throw new Error(`electron-builder exited with status ${status}`)
  }
}

export async function packageElectronBuilder(): Promise<Array<string>> {
  await runElectronBuilder()

  const distRoot = getDistRoot()
  const appImageInstaller = `${distRoot}/GitHubDesktop-linux-*.AppImage`

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
export async function packageWindowsElectronBuilder(): Promise<Array<string>> {
  await runElectronBuilder()

  const distRoot = getDistRoot()
  const installerGlob = `${distRoot}/GitHubDesktopSetup-*.exe`
  const manifestGlob = `${distRoot}/latest*.yml`

  const installers = await globPromise(installerGlob)
  if (installers.length === 0) {
    return Promise.reject(
      `No NSIS installer found at '${installerGlob}' after electron-builder run.`
    )
  }
  const manifests = await globPromise(manifestGlob)

  return [...installers, ...manifests]
}
