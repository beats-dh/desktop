# [GitHub Desktop](https://desktop.github.com) - The Linux Fork

[![CI](https://github.com/beats-dh/desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/beats-dh/desktop/actions/workflows/ci.yml)

[GitHub Desktop](https://desktop.github.com/) is an open-source [Electron](https://www.electronjs.org/)-based
GitHub app. It is written in [TypeScript](https://www.typescriptlang.org) and
uses [React](https://reactjs.org/).

<picture>
  <source
    srcset="https://user-images.githubusercontent.com/634063/202742848-63fa1488-6254-49b5-af7c-96a6b50ea8af.png"
    media="(prefers-color-scheme: dark)"
  />
  <img
    width="1072"
    src="https://user-images.githubusercontent.com/634063/202742985-bb3b3b94-8aca-404a-8d8a-fd6a6f030672.png"
    alt="A screenshot of the GitHub Desktop application showing changes being viewed and committed with two attributed co-authors"
  />
</picture>

## What is this repository for?

This repository contains specific patches on top of the upstream
`desktop/desktop` repository to support Linux usage.

> **Update Status:** This fork has been recently synchronized with the upstream GitHub Desktop version `3.5.9-beta2`. Extensive updates were made to ensure continued Linux compatibility, including:
> - **Build & Packaging:** Node.js script fixes, patch application adjustments, and `webpack` memory limits for stable builds.
> - **Runtime & UI:** Fixed sandbox-related launch issues (`--no-sandbox` integration where needed on Linux), added missing Linux UI elements (like `TitleBarStyle` and `ConfirmRestart` popups), and correctly configured protocol-style app URL handling for Linux.
> - **Stores Architecture:** Addressed TypeErrors caused by merge discrepancies, ensuring resilience in `CopilotStore` and other app state handlers.


It also publishes [releases](https://github.com/beats-dh/desktop/releases) for various Linux distributions:

 - AppImage (`.AppImage`)
 - Debian (`.deb`)
 - RPM (`.rpm`)

## Installation

Download the package for your distribution from the [releases page](https://github.com/beats-dh/desktop/releases):

| Format      | For                                |
| ----------- | ---------------------------------- |
| `.AppImage` | Universal Linux (no install)       |
| `.deb`      | Debian/Ubuntu and derivatives      |
| `.rpm`      | Fedora/RHEL/OpenSUSE              |

`.deb` and `.rpm` install via `sudo apt install ./<file>.deb` or `sudo dnf install ./<file>.rpm`. `.AppImage` runs directly after `chmod +x` — no installation step.

> This fork does not maintain its own APT/RPM feeds. If you need an auto-updating package via your distro's package manager, the [@shiftkey](https://github.com/shiftkey/desktop#installation-via-package-manager) fork hosts upstream feeds.

## Known issues

If you're having troubles with Desktop, please refer to the [Known issues](docs/known-issues.md#linux)
document for guidance and workarounds for common limitations.

## More information

Please check out the [README](https://github.com/desktop/desktop#github-desktop)
on the upstream [GitHub Desktop project](https://github.com/desktop/desktop) and
[desktop.github.com](https://desktop.github.com) for more product-oriented
information about GitHub Desktop.

See our [getting started documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) for more information on how to set up, authenticate, and configure GitHub Desktop.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).
