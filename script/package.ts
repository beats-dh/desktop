/* eslint-disable no-sync */

import * as cp from 'child_process'
import { createReadStream } from 'fs'
import { writeFile } from 'fs/promises'
import { pathExists, chmod } from 'fs-extra'
import * as path from 'path'
import * as crypto from 'crypto'

import { getProductName } from '../app/package-info'
import {
  getDistPath,
  getOSXZipPath,
  isPublishable,
  getBundleSizes,
  getDistRoot,
} from './dist-info'
import { isGitHubActions } from './build-platforms'
import { rmSync, writeFileSync } from 'fs'
import { assertNonNullable } from '../app/src/lib/fatal-error'

import {
  packageElectronBuilder,
  packageWindowsElectronBuilder,
} from './package-electron-builder'
import { packageDebian } from './package-debian'
import { packageRedhat } from './package-redhat'

const distPath = getDistPath()
const productName = getProductName()

async function main() {
  if (process.platform === 'darwin') {
    packageOSX()
  } else if (process.platform === 'win32') {
    await packageWindows()
  } else if (process.platform === 'linux') {
    await packageLinux()
  } else {
    console.error(`I don't know how to package for ${process.platform} :(`)
    process.exit(1)
  }

  console.log('Writing bundle size info…')
  writeFileSync(
    path.join(getDistRoot(), 'bundle-size.json'),
    JSON.stringify(getBundleSizes())
  )
}

main().catch(err => {
  console.error('Packaging failed', err)
  process.exit(1)
})

function packageOSX() {
  const dest = getOSXZipPath()
  rmSync(dest, { recursive: true, force: true })

  console.log('Packaging for macOS…')
  cp.execSync(
    `ditto -ck --keepParent "${distPath}/${productName}.app" "${dest}"`
  )
}

async function packageWindows() {
  // Windows packaging is now electron-builder NSIS so the bundle is
  // compatible with `electron-updater` (Squirrel.Windows isn't on its
  // supported list). The Azure Code Signing setup-step in CI installs the
  // signing client; electron-builder picks it up via `azureSignOptions`
  // in `script/electron-builder.yml`.
  if (isGitHubActions() && isPublishable()) {
    assertNonNullable(process.env.RUNNER_TEMP, 'Missing RUNNER_TEMP env var')
  }

  console.log('Packaging for Windows…')
  try {
    const files = await packageWindowsElectronBuilder()
    console.log('Installers created:')
    for (const file of files) {
      console.log(` - ${file}`)
    }
    await generateChecksums(files.filter(f => f.endsWith('.exe')))
  } catch (e) {
    console.error(`Error packaging: ${e}`)
    process.exit(1)
  }
}

function getSha256Checksum(fullPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const algo = 'sha256'
    const shasum = crypto.createHash(algo)

    const s = createReadStream(fullPath)
    s.on('data', function (d) {
      shasum.update(d)
    })
    s.on('error', err => {
      reject(err)
    })
    s.on('end', function () {
      const d = shasum.digest('hex')
      resolve(d)
    })
  })
}

async function generateChecksums(files: Array<string>) {
  const distRoot = getDistRoot()

  const checksums = new Map<string, string>()

  for (const f of files) {
    const checksum = await getSha256Checksum(f)
    checksums.set(f, checksum)
  }

  let checksumsText = `Checksums: \n`

  for (const [fullPath, checksum] of checksums) {
    const fileName = path.basename(fullPath)
    checksumsText += `${checksum} - ${fileName}\n`

    const checksumFilePath = `${fullPath}.sha256`
    await writeFile(checksumFilePath, checksum)
  }

  const checksumFile = path.join(distRoot, 'checksums.txt')

  await writeFile(checksumFile, checksumsText)
}

async function packageLinux() {
  const helperPath = path.join(getDistPath(), 'chrome-sandbox')
  const exists = await pathExists(helperPath)

  if (exists) {
    console.log('Updating file mode for chrome-sandbox…')
    await chmod(helperPath, 0o4755)
  }
  try {
    const files = await packageElectronBuilder()
    const debianPackage = await packageDebian()
    const redhatPackage = await packageRedhat()

    const installers = [...files, debianPackage, redhatPackage]

    console.log(`Installers created:`)
    for (const installer of installers) {
      console.log(` - ${installer}`)
    }

    generateChecksums(installers)
  } catch (err) {
    console.error('A problem occurred with the packaging step', err)
    process.exit(1)
  }
}
