<div align="center">

# 🔓 Helium DRM Fixer

**Make DRM-protected video play in the [Helium browser](https://helium.is/) — with one line, on Windows and Linux.**

It finds Widevine in the browsers and apps you already have, installs it into Helium in exactly the layout Helium expects, and reopens Helium with your tabs. No paths to type, no files to copy by hand.

[![Latest release](https://img.shields.io/github/v/release/OctavianAdv/helium-drm-fixer?label=release&color=2ea44f)](https://github.com/OctavianAdv/helium-drm-fixer/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/OctavianAdv/helium-drm-fixer/total?color=blue)](https://github.com/OctavianAdv/helium-drm-fixer/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE.md)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux-lightgrey)
![Built with Bun](https://img.shields.io/badge/built%20with-Bun-f9f1e1?logo=bun&logoColor=black)

</div>

---

## ⚡ Quick start

**Windows** — open PowerShell and paste:

```powershell
irm https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.ps1 | iex
```

**Linux** — open a terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.sh | bash
```

That's it. When it says **✅ Done**, DRM works in Helium.

What you'll see:

```text
🔧 Fixing Helium DRM...

✔ Using Widevine 4.10.3112.0 from Google Chrome (2 other copies found)
✔ Found Helium at: C:\Users\you\AppData\Local\imput\Helium\Application\143.0.7499.170

Helium is open. Close it now to apply the fix? It will reopen afterwards. [Y/n] y
✔ Closed Helium
✔ WidevineCdm copied successfully!

✅ Done! Helium has been reopened with DRM enabled.
```

---

## 📚 Contents

- [The problem](#-the-problem)
- [Why this fixer](#-why-this-fixer)
- [Features](#-features)
- [Where it gets Widevine from](#-where-it-gets-widevine-from)
- [Tested results](#-tested-results)
- [Install and run](#-install-and-run)
- [Options](#%EF%B8%8F-options)
- [How it works](#-how-it-works)
- [After a Helium update](#-after-a-helium-update)
- [Undo the fix](#%EF%B8%8F-undo-the-fix)
- [Safety and privacy](#-safety-and-privacy)
- [Limitations](#%EF%B8%8F-limitations)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-faq)
- [Development](#%EF%B8%8F-development)
- [License and legal](#-license-and-legal)

---

## 🧩 The problem

Streaming services protect their videos with **DRM** (Digital Rights Management). In Chromium-based browsers, that DRM is **Widevine**, a small closed-source module from Google called the *Content Decryption Module* (CDM).

Helium is a privacy-focused browser built from open-source Chromium. Widevine isn't open source, so Helium doesn't ship it, and Helium doesn't fetch it from Google on its own. The result: protected videos simply don't play. A quick check in Helium's developer console shows it:

```js
navigator.requestMediaKeySystemAccess('com.widevine.alpha', [...])
// ✗ Unsupported keySystem or supportedConfigurations.
```

Widevine, though, is very likely **already on your computer**: Chrome, Edge, Brave, Firefox, Spotify and many other apps keep their own copy. This tool takes one of those copies and installs it into Helium, the same way Chromium itself would.

---

## 🏆 Why this fixer

There are a few ways to get Widevine into Helium. Here is how they compare:

| | Copying by hand | A typical fix script | **Helium DRM Fixer** |
| --- | :---: | :---: | :---: |
| Works on Windows **and** Linux | ✅ if you know the paths | Usually one OS | ✅ **Both, same command** |
| One-line install, nothing left behind | ❌ | Rarely | ✅ `irm … \| iex` / `curl … \| bash` |
| Download is verified (SHA-256) | – | Rarely | ✅ **Every run** |
| Finds Helium without you typing a path | ❌ | Fixed paths only | ✅ **Installer, registry, running window, portable zip, AppImage** |
| Gets Widevine from more than just Chrome | ❌ | Chrome only | ✅ **25+ browsers and apps, incl. Firefox and Spotify** |
| Picks the **newest** Widevine you have | ❌ | ❌ | ✅ |
| Rejects broken or wrong-CPU copies | ❌ | ❌ | ✅ **Checks the manifest, the library and its CPU type** |
| Converts Firefox's Widevine for Helium | ❌ | ❌ | ✅ |
| Works without Chrome installed | ❌ | ❌ | ✅ **Uses another browser, or downloads Chrome just for Widevine** |
| Closes and reopens Helium safely | ❌ | ❌ | ✅ **Asks first, saves your tabs, restores them** |
| Clear message when files are locked | ❌ | ❌ | ✅ |
| Correct Linux method (profile folder + hint file) | Easy to get wrong | Easy to get wrong | ✅ **Works with AppImage, tarball and distro packages** |
| Safe with `sudo` on Linux | – | Can write to root's home | ✅ **Uses your home and gives the files back to you** |
| Dry run and check modes | – | Rarely | ✅ `--dry-run`, `--check`, `--list-sources` |
| Tested against a real Helium | – | Unknown | ✅ **[See results](#-tested-results)** |

---

## ✨ Features

- **One command, zero setup.** The installers download the latest release, verify its SHA-256 checksum, run it and delete it afterwards. Nothing stays installed and nothing gets added to your PATH.
- **Finds Helium anywhere**:
  - Windows: per-user and all-users installs, the Windows registry, a Helium window that's open right now, and portable copies unpacked in Downloads, Desktop, Documents, your user folder or `C:\`.
  - Linux: `/opt/helium` (deb/rpm), AppImages, binaries on your `PATH`. If Helium was installed but never opened, it creates the profile folder for you.
- **Finds Widevine anywhere.** It searches 25+ browsers and apps, including all release channels, Flatpak and Snap versions, Firefox and its forks, Spotify, and apps with a built-in browser such as OBS or Windows WebView2 apps.
- **Picks the best copy.** It reads the version of every copy it finds and uses the newest; Chrome wins a tie.
- **Never installs a broken copy.** Each candidate must have a valid `manifest.json` with a version and the actual CDM library, built for your CPU. Browsers often leave empty `WidevineCdm` folders behind; those are skipped.
- **Converts Firefox's Widevine.** Firefox, LibreWolf, Zen, Floorp and Waterfox store Widevine in a flat folder. The tool rebuilds it into Chromium's `_platform_specific/<os>_<cpu>/` layout and fills in any manifest fields Chromium needs.
- **Handles a running Helium (Windows).** It asks before closing Helium, closes it the polite way so your session is saved, applies the fix, and reopens Helium with the same settings plus `--restore-last-session`. The reopened Helium is started by Windows itself, so it stays open after the terminal closes.
- **Downloads only as a last resort.** If no browser or app on your computer has Widevine, it downloads Chrome just to take Widevine from it:
  - Windows: an official uncompressed Chrome installer, unpacked with a 7-Zip bundled inside the fixer.
  - Linux: Google's official `.deb`, unpacked without `dpkg`, so it works on any distro.

  Downloads are cached and checksum-verified, so running the tool again is instant.
- **Friendly, honest errors.** Locked files, missing permissions, no Helium, no Widevine: each one gets a plain-language explanation of what to do next.
- **Safe to explore.** `--check`, `--dry-run` and `--list-sources` never change anything.
- **Single self-contained executable.** Built with [Bun](https://bun.sh/). No runtime, Node.js or Python to install.

---

## 🌐 Where it gets Widevine from

| Browser / app | Windows | Linux |
| --- | :---: | :---: |
| **Google Chrome** (Stable, Beta, Dev, Canary) | ✅ | ✅ (also Flatpak) |
| **Microsoft Edge** (Stable, Beta, Dev, Canary) | ✅ | ✅ (also Flatpak) |
| **Brave** (Stable, Beta, Nightly) | ✅ | ✅ (also Flatpak, Snap) |
| **Vivaldi** | ✅ | ✅ (also Flatpak) |
| **Opera, Opera GX, Opera Air** | ✅ | ✅ Opera (also Flatpak) |
| **Yandex Browser** | ✅ | ✅ |
| **Chromium** | ✅ | ✅ (also Snap, Flatpak, distro packages) |
| **Thorium** | ✅ | ✅ |
| **Arc, Supermium, Cent Browser** | ✅ | – |
| **Firefox** | ✅ (also Microsoft Store) | ✅ (also Flatpak, Snap) |
| **LibreWolf, Zen, Floorp, Waterfox** | ✅ | ✅ (also Flatpak) |
| **Spotify** | ✅ (also Microsoft Store) | – |
| **Apps with a built-in browser** (OBS, WebView2 apps, CEF apps, …) | ✅ | ✅ |

See exactly what it finds on your computer:

```bash
fix-helium-drm --list-sources
```

```text
Found 4 Widevine copies (best first):

→ Google Chrome                            4.10.3112.0
    C:\Program Files\Google\Chrome\Application\155.0.8059.26\WidevineCdm
  Spotify                                  4.10.3112.0
    C:\Users\you\AppData\Local\Spotify\WidevineCdm\4.10.3112.0
  MicrosoftWindows.Client.CBS (WebView2)   4.10.3112.0
    C:\Users\you\AppData\Local\Packages\MicrosoftWindows.Client.CBS_…\EBWebView\WidevineCdm\4.10.3112.0
  Microsoft Edge                           4.10.3050.1
    C:\Program Files (x86)\Microsoft\Edge\Application\155.0.4283.62\WidevineCdm
```

…and pick one yourself with `--from`, e.g. `--from edge`, `--from firefox` or `--from spotify`.

---

## 🧪 Tested results

Every source below was installed into a real **Helium 0.19.4.1** (portable, Windows 11 x64). After each install, Helium itself was asked whether Widevine is available, through `navigator.requestMediaKeySystemAccess('com.widevine.alpha', …)`:

| Widevine source | Version | Helium result |
| --- | --- | --- |
| *(no fix applied)* | – | ❌ Unsupported keySystem |
| Google Chrome | 4.10.3112.0 | ✅ **Widevine supported** |
| Microsoft Edge | 4.10.3050.1 | ✅ **Widevine supported** |
| Spotify | 4.10.3112.0 | ✅ **Widevine supported** |
| Windows WebView2 component | 4.10.3112.0 | ✅ **Widevine supported** |
| Firefox (converted from its flat layout) | 4.10.3050.0 | ✅ **Widevine supported** |

Also tested on Windows:

- **Public one-liner** (`irm … | iex`) end to end.
- **Auto-detection** of a running portable Helium, with no paths given.
- **Close → fix → reopen**, including a second run while Widevine was in use.
- **Compiled `.exe` without `node_modules`**, including the Chrome download and 7-Zip extraction.

On Linux, the download, `.deb` extraction and profile-folder logic run in simulation and in unit tests. Reports from real Linux machines are very welcome: [open an issue](https://github.com/OctavianAdv/helium-drm-fixer/issues).

---

## 📦 Install and run

### Option 1: one line (recommended)

| | Command |
| --- | --- |
| **Windows** | `irm https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.ps1 \| iex` |
| **Linux** | `curl -fsSL https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.sh \| bash` |

With [options](#%EF%B8%8F-options):

```powershell
# Windows
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.ps1))) --list-sources
```

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.sh | bash -s -- --list-sources
```

Prefer to read a script before running it? It's short, and that's a good habit:
[`install.ps1`](install.ps1) · [`install.sh`](install.sh).

### Option 2: download the executable

Get the file for your system from the [latest release](https://github.com/OctavianAdv/helium-drm-fixer/releases/latest). The release also includes `SHA256SUMS.txt`, so you can verify the file yourself.

| System | File |
| --- | --- |
| Windows (x64, also runs on ARM through emulation) | `fix-helium-drm-windows-x64.exe` |
| Linux (x64) | `fix-helium-drm-linux-x64` |
| Linux (ARM64) | `fix-helium-drm-linux-arm64` |

**Windows:** open PowerShell in the download folder:

```powershell
.\fix-helium-drm-windows-x64.exe
```

If Helium is installed for all users (in `C:\Program Files`), use an Administrator terminal.

**Linux:**

```bash
chmod +x fix-helium-drm-linux-x64
./fix-helium-drm-linux-x64
```

No `sudo` needed: Helium's profile is in your home folder. (If you do use `sudo`, the tool still writes to *your* profile and hands the files back to you.)

### Option 3: run from source

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/OctavianAdv/helium-drm-fixer.git
cd helium-drm-fixer
bun install
bun run cli.ts
```

---

## ⚙️ Options

In the examples, `fix-helium-drm` stands for however you run the tool: the one-liner, the downloaded executable (`.\fix-helium-drm-windows-x64.exe` or `./fix-helium-drm-linux-x64`) or `bun run cli.ts`.

| Option | What it does |
| --- | --- |
| `--check` | Find everything and report whether the fix can be applied. Changes nothing. |
| `--dry-run` | Show which Widevine would be copied, and where. Changes nothing. |
| `--list-sources` | List every Widevine copy on this computer, best first. Changes nothing. |
| `--from <name>` | Use the copy from a specific browser or app, such as `edge`, `brave`, `firefox` or `spotify`. Matches part of the name. |
| `--chrome-path <path>` | Use the Widevine folder at this exact path. Chromium and Firefox layouts both work. |
| `--helium-path <path>` | Use this Helium folder: the version folder or portable folder on Windows/macOS, the profile folder on Linux. |
| `-y`, `--yes` | Close and reopen Helium without asking (Windows). |
| `--force-download` | Ignore local copies and download Chrome again, even if it is cached. |
| `--verbose`, `--debug` | Show every location checked and every decision made. |
| `-V`, `--version` | Show the version. |
| `-h`, `--help` | Show help. |

### Examples

```bash
# What would happen? (safe)
fix-helium-drm --dry-run

# Use Edge's Widevine, and don't ask before closing Helium
fix-helium-drm --from edge --yes

# Portable Helium on another drive
fix-helium-drm --helium-path "D:\Apps\helium_0.19.4.1_x64-windows"

# Linux: a specific Widevine folder and profile
fix-helium-drm --chrome-path /opt/google/chrome/WidevineCdm --helium-path ~/.config/net.imput.helium

# Something's off? See every step
fix-helium-drm --verbose
```

---

## 🔍 How it works

```text
 ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ 1. Find Widevine     │──▶│ 2. Find Helium       │──▶│ 3. Close if needed   │──▶│ 4. Install & reopen  │
 │ 25+ browsers & apps  │   │ installer, registry, │   │ ask, close politely  │   │ right layout, right  │
 │ newest valid copy    │   │ running, portable,   │   │ (Windows file locks) │   │ folder, reopen with  │
 │ (download if none)   │   │ AppImage, profile    │   │                      │   │ your tabs            │
 └──────────────────────┘   └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

1. **Find Widevine.** Every location in the [table above](#-where-it-gets-widevine-from) is checked.
   - Each copy is validated: a manifest with a version, the CDM library for your OS (`widevinecdm.dll` or `libwidevinecdm.so`), and a CPU type that matches your system (read from the library's PE/ELF header).
   - The newest valid copy wins.
   - Apps with a built-in browser are searched when no browser has Widevine, or when you ask with `--list-sources` or `--from`.
   - If nothing is found, Chrome is downloaded and Widevine is taken from it.
2. **Find Helium.**
   - **Windows:** the folder holding Helium's `chrome.dll`. That's `…\imput\Helium\Application\<version>\` for the installer, or the unpacked folder for the portable zip. Helium's Windows program is also named `chrome.exe`, so the tool only accepts paths containing "helium" and never mistakes Google Chrome for Helium.
   - **Linux:** Helium's profile folder, `~/.config/net.imput.helium`. Chromium on Linux loads Widevine from here, so it works the same for every install type.
3. **Close Helium if needed (Windows).** Windows locks files that are in use. The tool asks, closes Helium gracefully (and only force-closes after 10 seconds), and remembers its exact command line.
4. **Install.**
   - **Windows:** `WidevineCdm\` goes next to `chrome.dll`.
   - **Linux:** `WidevineCdm/<version>/` goes in the profile, with the `latest-component-updated-widevine-cdm` hint file Chromium reads at startup.
   - Firefox copies are converted on the way. Then Helium is reopened.

---

## 🔁 After a Helium update

- **Windows (installer):** Helium installs each update into a new `Application\<version>\` folder, so the new version starts without Widevine. Just run the one-liner again; it takes a few seconds.
- **Windows (portable):** if you unpack a new zip, run the tool again.
- **Linux:** the fix lives in your Helium profile, so it **survives Helium updates**. Run the tool again only if you want a newer Widevine.

---

## ↩️ Undo the fix

Delete the `WidevineCdm` folder the tool created, then restart Helium:

| System | Folder to delete |
| --- | --- |
| Windows (installer) | `%LOCALAPPDATA%\imput\Helium\Application\<version>\WidevineCdm` |
| Windows (portable) | `<your Helium folder>\WidevineCdm` |
| Linux | `~/.config/net.imput.helium/WidevineCdm` |

Not sure where it went? `fix-helium-drm --dry-run` prints the exact path.

---

## 🔒 Safety and privacy

- **Verified downloads.** The one-line installers check the executable's SHA-256 against the `SHA256SUMS.txt` published with each release, and refuse to run on a mismatch. Chrome downloads are checksum-cached too.
- **No telemetry.** The tool collects nothing and phones home to nobody. It only goes online to:
  - download itself from GitHub (one-line installers only), and
  - download Chrome, only if no Widevine exists on your computer (GitHub on Windows, `dl.google.com` on Linux).
- **No admin rights, normally.** Everything happens in your user folders. Administrator rights are only needed if Helium is installed for all users in `C:\Program Files`.
- **Changes only one folder.** Your other browsers' Widevine copies are only read, never modified. In Helium, only the `WidevineCdm` folder is written.
- **Asks before closing Helium.** It closes Helium the normal way so your session is saved, and restores your tabs when it reopens.
- **Open source.** Every line is in this repository, under the MIT license.

---

## ⚠️ Limitations

This tool gives Helium a working Widevine CDM. It does **not** change Helium's Chromium build, browser identity, codecs, HDCP support, Widevine certification level, or Verified Media Path (VMP) status.

- **Usually works:** sites that accept any browser with Widevine, for example YouTube movies and Crunchyroll.
- **May fail or be limited:** services with strict checks, such as Netflix or Amazon Prime Video. They can require an approved browser, VMP signatures, hardware-backed security or output protection that no copied CDM can provide, and may limit video quality where they do play.
- **ARM64 Linux:** Google doesn't publish Chrome for ARM Linux, so the automatic download isn't available there. A local copy (for example from Chromium or Firefox) still works, or pass `--chrome-path`.
- **macOS:** basic support is in the code (copy plus re-signing Helium.app), but it isn't the focus and isn't tested.

---

## 🩺 Troubleshooting

<details>
<summary><b>"Helium browser not found"</b></summary>

Install Helium from [helium.is](https://helium.is/). If it's somewhere unusual, for example a portable copy on another drive:

- open Helium and run the tool again (it finds a running Helium), or
- pass `--helium-path "D:\path\to\helium"`.

</details>

<details>
<summary><b>"WidevineCdm is in use"</b></summary>

Helium is still running and you chose not to close it. Run the tool again and answer **Y**, or add `--yes`. On Windows, also check the system tray for a background Helium.

</details>

<details>
<summary><b>"No Widevine found" / "Failed to find or download Widevine"</b></summary>

No browser or app on your computer has Widevine yet, and downloading Chrome failed (often a firewall or proxy). Install any supported browser, play a DRM video in it once so it downloads Widevine, and run the tool again. `--list-sources` shows what it can see.

</details>

<details>
<summary><b>"Failed to copy WidevineCdm" / "Permission denied"</b></summary>

- **Windows:** Helium is probably installed for all users; use an Administrator PowerShell.
- **Linux:** check that you own `~/.config/net.imput.helium`.

</details>

<details>
<summary><b>The fix ran, but a site still doesn't play</b></summary>

1. Fully restart Helium. On Windows, check the system tray too.
2. Check that Helium sees Widevine: open DevTools (F12) on any `https://` page and run
   `navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{initDataTypes: ['cenc'], videoCapabilities: [{contentType: 'video/mp4; codecs="avc1.42E01E"'}]}]).then(() => 'supported', e => e.message)`.
   It should print `supported`.
3. Try a simpler DRM test first, for example the Widevine demo at [bitmovin.com/demos/drm](https://bitmovin.com/demos/drm).
4. If the simple test works but a particular service doesn't, see [Limitations](#%EF%B8%8F-limitations): that service is probably checking more than Widevine.
5. Try a different Widevine: `fix-helium-drm --list-sources`, then for example `--from edge`.

</details>

<details>
<summary><b>The one-liner says "Checksum mismatch"</b></summary>

The download was corrupted or altered, so the installer refused to run it. This is the safety check doing its job. Try again in a minute; GitHub occasionally serves a stale file right after a new release.

</details>

---

## ❓ FAQ

**Is this legal?**
The tool doesn't contain or distribute Widevine. It copies the Widevine module that your own, legitimately installed software already downloaded from Google, onto your own computer. Whether a streaming service allows a given browser is between you and that service. See [License and legal](#-license-and-legal).

**Will this get my streaming account banned?**
Services generally just decline to play in browsers they don't support. That said, each service has its own terms of use, so check them if you're unsure.

**Does it slow down or change Helium?**
No. It only adds the `WidevineCdm` folder, exactly as if Helium had downloaded it itself. Helium's settings, extensions and privacy features are untouched.

**Which Widevine copy is best?**
Usually the newest, and that's what the tool picks automatically. All copies come from Google, so a copy from Spotify works just like one from Chrome.

**Do I need to keep Chrome installed?**
No. Once Widevine is copied, Helium has its own copy. You can even run the fixer with no Chrome at all: it uses another browser's copy, or downloads Chrome temporarily just to take Widevine from it.

**Why is the executable ~100 MB?**
It's a single self-contained file that includes the Bun runtime, so you don't need to install anything. The one-liner deletes it after running.

**Does it work with Helium's portable version?**
Yes. That's one of the tested setups.

---

## 🛠️ Development

```bash
bun install          # install dependencies
bun test             # run the test suite
bun run typecheck    # TypeScript type check
bun run cli.ts       # run from source
bun run build        # build an executable for this system
bun run build:all    # build Windows x64, Linux x64 and Linux ARM64 into ./dist
```

### Project structure

```text
cli.ts                    Command-line options
commands/index.ts         The fix: find → close → install → reopen
lib/widevine.ts           Widevine sources, validation, CPU detection, Firefox conversion
lib/paths.ts              Finding Chrome and Helium on each OS
lib/windows.ts            Registry, running processes, closing/reopening programs
lib/chrome-downloader.ts  Chrome download (GitHub on Windows, .deb on Linux), caching
lib/deb.ts                Minimal .deb (ar) reader
lib/extractor.ts          Bundled 7-Zip extraction (Windows)
install.ps1 / install.sh  One-line installers
scripts/release.ts        One-command release
```

### Releasing

```bash
bun run release patch   # 1.2.0 -> 1.2.1 (or: minor, major, 1.3.0)
```

One command does the whole flow:

1. Checks that everything is committed and up to date.
2. Runs the type check and tests.
3. Bumps the version in `package.json`.
4. Builds all executables with SHA-256 checksums.
5. Commits, tags and pushes.
6. Publishes the GitHub release, with notes generated from the `feat:` / `fix:` commits since the last release.

Pushing a `v*` tag also lets GitHub Actions rebuild and re-upload the same files.

### Contributing

Issues and pull requests are welcome, especially:

- **Linux test reports:** your distro, how Helium was installed, and the `--verbose` output.
- **New Widevine locations:** a browser or app that keeps Widevine somewhere the tool doesn't check yet.

Commit messages follow a simple style: `feat: …` for new features, `fix: …` for bug fixes, `docs: …` for documentation, written as a plain-English sentence.

---

## 📜 License and legal

The code in this repository is released under the **[MIT License](LICENSE.md)**. Copyright © 2026 OctavianAdv. A plain-language summary, the Widevine notice and all third-party licenses are in **[NOTICE.md](NOTICE.md)**.

**About Widevine.** Widevine is proprietary software owned by Google LLC. This project does **not** include, bundle or redistribute the Widevine CDM. The tool only copies a Widevine module that already exists on the user's computer (or that the user's machine downloads directly from Google as part of Chrome) into the user's own Helium installation. The MIT license covers this tool's code only; Widevine remains under Google's own terms.

**Third-party software** included in the executables (7-Zip, Bun, and npm packages) is listed with its licenses in [NOTICE.md](NOTICE.md#third-party-software).

**Not affiliated.** This is an independent community project. It is not affiliated with, endorsed by or sponsored by imput (Helium), Google, Microsoft, Mozilla, Brave, Opera, Vivaldi, Spotify or any streaming service. All product names and trademarks belong to their owners.

---

## 🙏 Credits

- [**Helium**](https://helium.is/) by imput — the privacy-focused browser this tool is made for
- [**Bun**](https://bun.sh/) — runtime and single-file compiler
- [**Bush2021/chrome_installer**](https://github.com/Bush2021/chrome_installer) — offline Chrome installers used for the Windows download
- [**7-Zip**](https://www.7-zip.org/) by Igor Pavlov — extraction on Windows
- [commander](https://github.com/tj/commander.js), [chalk](https://github.com/chalk/chalk), [ora](https://github.com/sindresorhus/ora), [pino](https://github.com/pinojs/pino) and [browser-finder](https://github.com/agent-infra/browser) — the building blocks

<div align="center">

**If this fixed Helium for you, consider giving the repo a ⭐ — it helps other Helium users find it.**

</div>
