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

  const electronBuilder = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    'electron-builder'
  )

  const configPath = path.resolve(__dirname, 'electron-builder.yml')

  const args = [
    'build',
    '--prepackaged',
    distPath,
    getArchitecture(),
    '--config',
    configPath,
  ]

  const { error, status } = cp.spawnSync(electronBuilder, args, {
    stdio: 'inherit',
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
