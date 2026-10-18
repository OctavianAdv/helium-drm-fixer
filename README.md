<div align="center">

# 🔓 Helium DRM Fixer

**Make DRM-protected video play in the [Helium browser](https://helium.computer/) — with one line, on Windows and Linux.**

It finds Widevine in the browsers and apps you already have (or downloads just Widevine from Google, ~20 MB), installs it into Helium in exactly the layout Helium expects, **proves it works by asking Helium itself**, and reopens Helium with your tabs. No paths to type, no files to copy by hand.

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

**Scoop** (Windows), to keep it installed:

```powershell
scoop install https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/packaging/scoop/helium-drm-fixer.json
```

That's it. When it says **✅ Done**, DRM works in Helium, and the tool has already checked that inside Helium.

What you'll see:

```text
🔧 Fixing Helium DRM...

✔ Found Helium 0.19.4.1 (x64): C:\Users\you\AppData\Local\imput\Helium\Application\143.0.7499.170
✔ Using Widevine 4.10.3112.0 from Google Chrome

Helium is open. Close it now to apply the fix? It will reopen afterwards. [Y/n] y
✔ Closed Helium
✔ Installed Widevine 4.10.3112.0 from Google Chrome
✔ Verified: Helium confirms Widevine DRM is available
  Helium has been reopened.

✅ Done! DRM is enabled in Helium.
```

Want it to stay fixed after Helium updates? Run it once with `--auto` (Windows).

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
| Gets Widevine from more than just Chrome | ❌ | Chrome only | ✅ **28 browsers and apps, incl. Brave, Edge, Firefox and Spotify** |
| Downloads **only Widevine** when needed | ❌ | Whole Chrome (~500 MB) | ✅ **~20 MB straight from Google, with Mozilla and Chrome as fallbacks** |
| **Proves** DRM works afterwards | ❌ | ❌ | ✅ **Asks Helium itself, invisibly, in about a second** |
| Stays fixed after Helium updates | ❌ | ❌ | ✅ **`--auto` re-applies it in the background (Windows); Linux never loses it** |
| ARM64 support | – | Rarely | ✅ **Windows and Linux ARM64, matched to Helium's own CPU** |
| Status, undo, fix every copy | ❌ | ❌ | ✅ `--status`, `--undo`, `--all` |
| Package managers | – | – | ✅ **Scoop today; winget and AUR manifests ready** |
| Picks the **newest** Widevine you have | ❌ | ❌ | ✅ |
| Rejects broken or wrong-CPU copies | ❌ | ❌ | ✅ **Checks the manifest, the library and its CPU type** |
| Converts Firefox's Widevine for Helium | ❌ | ❌ | ✅ |
| Works without Chrome installed | ❌ | ❌ | ✅ **Uses another browser, or downloads just Widevine** |
| Closes and reopens Helium safely | ❌ | ❌ | ✅ **Asks first, saves your tabs, restores them** |
| Clear message when files are locked | ❌ | ❌ | ✅ |
| Correct Linux method (profile folder + hint file) | Easy to get wrong | Easy to get wrong | ✅ **Works with AppImage, tarball and distro packages** |
| Safe with `sudo` on Linux | – | Can write to root's home | ✅ **Uses your home and gives the files back to you** |
| Dry run and check modes | – | Rarely | ✅ `--dry-run`, `--check`, `--list-sources` |
| Tested against a real Helium | – | Unknown | ✅ **[See results](#-tested-results)**, plus an automated weekly test |

---

## ✨ Features

- **One command, zero setup.** The installers download the latest release, verify its SHA-256 checksum, run it and delete it afterwards. Nothing stays installed and nothing gets added to your PATH.
- **Finds Helium anywhere**:
  - Windows: per-user and all-users installs, the Windows registry, a Helium window that's open right now, and portable copies unpacked in Downloads, Desktop, Documents, your user folder or `C:\`.
  - Linux: `/opt/helium` (deb/rpm), AppImages, binaries on your `PATH`. If Helium was installed but never opened, it creates the profile folder for you.
- **Finds Widevine anywhere.** It searches 28 browsers and apps, including all release channels, Flatpak and Snap versions, Firefox and its forks, Spotify, and apps with a built-in browser such as OBS or Windows WebView2 apps.
- **Picks the best copy.** It reads the version of every copy it finds and uses the newest; Chrome wins a tie.
- **Never installs a broken copy.** Each candidate must have a valid `manifest.json` with a version and the actual CDM library, built for your CPU. Browsers often leave empty `WidevineCdm` folders behind; those are skipped.
- **Converts Firefox's Widevine.** Firefox, LibreWolf, Zen, Floorp and Waterfox store Widevine in a flat folder. The tool rebuilds it into Chromium's `_platform_specific/<os>_<cpu>/` layout and fills in any manifest fields Chromium needs.
- **Handles a running Helium (Windows).** It asks before closing Helium, closes it the polite way so your session is saved, applies the fix, and reopens Helium with the same settings plus `--restore-last-session`. The reopened Helium is started by Windows itself, so it stays open after the terminal closes.
- **Downloads just Widevine, only when needed.** If no browser or app on your computer has Widevine, it asks Google's component update server (the same one Chrome, Edge and Brave use) for the Widevine package: about 20 MB, verified by SHA-256. If Google can't be reached, it tries Mozilla's update server (Firefox's route). Only as a last resort does it download all of Chrome to take Widevine from it. Downloads are cached, so running again is instant. `--latest` also checks Google for a newer Widevine than your browsers have; `--offline` never downloads anything.
- **Proves it works.** After installing, it starts Helium invisibly with a throw-away profile, opens a local page (no internet needed) and asks Helium whether Widevine is available, exactly like a streaming site would. It takes about a second, and your own Helium profile is never touched.
- **Stays fixed (Windows).** `--auto` installs a hidden scheduled task (at logon and every hour, no admin rights needed) that re-applies the fix when a Helium update arrives. `--auto off` removes it completely. On Linux the fix lives in your profile and survives updates by itself.
- **Matches Helium's CPU.** It reads whether Helium is x64 or ARM64 from Helium's own files and picks or downloads the matching Widevine, including on Windows on ARM and ARM64 Linux.
- **Status, undo and multiple installs.** `--status` shows each Helium, its Widevine version and whether DRM works. `--undo` removes the fix cleanly. `--all` fixes every Helium it finds (installed and portable). Already up to date? It says so and doesn't touch Helium.
- **Double-click friendly.** Started from Explorer, the window stays open until you press Enter, so you can read the result.
- **Tells you about updates.** When a newer version of the fixer exists, it says so at the end (never when run through the always-latest one-liners).
- **Friendly, honest errors.** Locked files, missing permissions, no Helium, no Widevine: each one gets a plain-language explanation of what to do next.
- **Safe to explore.** `--status`, `--check`, `--dry-run` and `--list-sources` never change anything.
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

Downloaded copies, installed and verified the same way:

| Download route | Version | Size | Helium result |
| --- | --- | --- | --- |
| Google component update server | 4.10.3112.0 | 23 MB (0.8 s) | ✅ **Widevine supported** |
| Mozilla update server | 4.10.3050.0 | 22.7 MB | ✅ **Widevine supported** |

Google's server also offers Widevine for Windows ARM64, Linux x64 and Linux ARM64 (checked), which is how ARM devices are covered.

Also tested on Windows:

- **Public one-liner** (`irm … | iex`) end to end.
- **Verification both ways:** it reports "supported" with the fix and "Unsupported keySystem" without it.
- **`--auto`:** task created without admin rights, window-less, and it re-installed Widevine after a simulated Helium update.
- **`--all`:** two portable Heliums open at once; both found, closed, fixed, verified and reopened.
- **`--status`, `--undo`, `--offline`, `--latest`, `--reinstall`**, and the double-click pause.
- **Auto-detection** of a running portable Helium, with no paths given.
- **Close → fix → reopen**, including a second run while Widevine was in use.
- **Compiled `.exe` without `node_modules`**, including the Chrome download and 7-Zip extraction.

On Linux, the download, `.deb` extraction and profile-folder logic run in simulation and in unit tests. An automated end-to-end test (real Helium, fix, verify, undo) is set up to run on every change and weekly. Reports from real Linux machines are very welcome: [open an issue](https://github.com/OctavianAdv/helium-drm-fixer/issues).

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

### Option 2: a package manager

| | Command | Status |
| --- | --- | --- |
| **Scoop** (Windows) | `scoop install https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/packaging/scoop/helium-drm-fixer.json` | ✅ Available |
| **winget** (Windows) | `winget install OctavianAdv.HeliumDrmFixer` | ⏳ Manifest ready, waiting for approval |
| **AUR** (Arch Linux) | `yay -S helium-drm-fixer-bin` | ⏳ PKGBUILD ready, not published yet |

Installed this way, the command is simply `fix-helium-drm`.

### Option 3: download the executable

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

### Option 4: run from source

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
| *(none)* | Find Helium and Widevine, install, verify, done. |
| `--status` | Show each Helium, its Widevine version, whether DRM works, available Widevine and auto-fix state. Changes nothing. |
| `--check` | Find everything and report whether the fix can be applied. Changes nothing. |
| `--dry-run` | Show which Widevine would be copied, and where. Changes nothing. |
| `--list-sources` | List every Widevine copy on this computer, best first. Changes nothing. |
| `--from <name>` | Use the copy from a specific browser or app, such as `edge`, `brave`, `firefox` or `spotify`. Matches part of the name. |
| `--latest` | Also ask Google whether a newer Widevine exists than your browsers have, and use it if so. |
| `--offline` | Never download anything; only use Widevine already on this computer. |
| `--force-download` | Download Widevine from Google even if a local copy exists. |
| `--chrome-path <path>` | Use the Widevine folder at this exact path. Chromium and Firefox layouts both work. |
| `--helium-path <path>` | Use this Helium folder: the version folder or portable folder on Windows/macOS, the profile folder on Linux. |
| `--all` | Fix every Helium found, e.g. both an installed and a portable copy. |
| `--reinstall` | Copy Widevine again even if Helium already has that version. |
| `--no-verify` | Skip the check inside Helium after installing. |
| `-y`, `--yes` | Close and reopen Helium without asking (Windows). |
| `--undo` | Remove the fix from Helium. |
| `--auto` / `--auto off` | Turn automatic re-fixing after Helium updates on or off (Windows). |
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

# Is DRM working right now?
fix-helium-drm --status

# Keep Helium fixed after every update (Windows)
fix-helium-drm --auto

# Fix both the installed and the portable Helium
fix-helium-drm --all

# Use the newest Widevine Google has, even if your browsers are behind
fix-helium-drm --latest

# Remove the fix
fix-helium-drm --undo

# Something's off? See every step
fix-helium-drm --verbose
```

**Exit codes** (for scripts): `0` done and verified · `1` something failed · `2` installed, but Helium couldn't confirm DRM works.

---

## 🔍 How it works

```text
 ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
 │ 1. Find Helium     │─▶│ 2. Find Widevine   │─▶│ 3. Close if needed │─▶│ 4. Install         │─▶│ 5. Verify & reopen │
 │ installer, regis-  │  │ 28 browsers & apps │  │ ask, close politely│  │ right layout,      │  │ ask Helium itself, │
 │ try, running, por- │  │ newest, right CPU  │  │ (Windows locks)    │  │ right folder       │  │ then reopen with   │
 │ table, AppImage    │  │ else Google ~20 MB │  │                    │  │                    │  │ your tabs          │
 └────────────────────┘  └────────────────────┘  └────────────────────┘  └────────────────────┘  └────────────────────┘
```

1. **Find Helium.**
   - **Windows:** the folder holding Helium's `chrome.dll`. That's `…\imput\Helium\Application\<version>\` for the installer, or the unpacked folder for the portable zip. Helium's Windows program is also named `chrome.exe`, so the tool only accepts paths containing "helium" and never mistakes Google Chrome for Helium.
   - **Linux:** Helium's profile folder, `~/.config/net.imput.helium`. Chromium on Linux loads Widevine from here, so it works the same for every install type.
   - Helium's CPU type (x64 or ARM64) is read from its own files (`chrome.dll` on Windows, the program file on Linux).
2. **Find Widevine.** Every location in the [table above](#-where-it-gets-widevine-from) is checked.
   - Each copy is validated: a manifest with a version, the CDM library for your OS (`widevinecdm.dll` or `libwidevinecdm.so`), and a CPU type that matches **Helium** (read from the library's PE/ELF header).
   - The newest valid copy wins.
   - Apps with a built-in browser are searched when no browser has Widevine, or when you ask with `--list-sources` or `--from`.
   - If nothing is found, Widevine is downloaded: Google's component update server first (the Widevine package itself, verified by SHA-256), then Mozilla's update server (SHA-512), then a full Chrome download as the last resort. The package is a CRX3 file, which the tool unpacks with its own built-in ZIP reader, so nothing extra has to be installed.
3. **Close Helium if needed (Windows).** Windows locks files that are in use. The tool asks, closes Helium gracefully (and only force-closes after 10 seconds), and remembers its exact command line.
4. **Install.**
   - **Windows:** `WidevineCdm\` goes next to `chrome.dll`.
   - **Linux:** `WidevineCdm/<version>/` goes in the profile, with the `latest-component-updated-widevine-cdm` hint file Chromium reads at startup.
   - Firefox copies are converted on the way. If Helium already has the same or a newer Widevine, nothing is copied.
5. **Verify and reopen.** Helium is started invisibly (`--headless`) with a throw-away profile and a tiny local web page on `127.0.0.1`. That address counts as a "secure context", so no internet is needed. Through the Chrome DevTools Protocol, the tool runs `navigator.requestMediaKeySystemAccess('com.widevine.alpha', …)` inside Helium (the same call streaming sites make) and reports the answer. Then your Helium is reopened with your tabs.

---

## 🔁 After a Helium update

- **Windows (installer):** Helium installs each update into a new `Application\<version>\` folder, so the new version starts without Widevine.
  - **Best:** run the fixer once with `--auto`. A hidden scheduled task then checks at logon and every hour and re-applies the fix by itself; you'll just need to restart Helium once after an update. No admin rights, no console windows popping up. The log is in `%LOCALAPPDATA%\helium-drm-fixer\auto-fix.log`; `--auto off` removes everything.
  - Or simply run the one-liner again; it takes a few seconds.
- **Windows (portable):** if you unpack a new zip, run the tool again (or use `--auto`; it also finds a running portable Helium).
- **Linux:** the fix lives in your Helium profile, so it **survives Helium updates**. Run the tool again only if you want a newer Widevine.

---

## ↩️ Undo the fix

```bash
fix-helium-drm --undo          # add --all to undo every Helium
```

It closes Helium if needed (asking first), removes the `WidevineCdm` folder it added, and reopens Helium. If you also turned on auto-fix, run `fix-helium-drm --auto off`.

Prefer to do it by hand? Delete this folder and restart Helium:

| System | Folder to delete |
| --- | --- |
| Windows (installer) | `%LOCALAPPDATA%\imput\Helium\Application\<version>\WidevineCdm` |
| Windows (portable) | `<your Helium folder>\WidevineCdm` |
| Linux | `~/.config/net.imput.helium/WidevineCdm` |

Not sure where it went? `fix-helium-drm --dry-run` prints the exact path.

---

## 🔒 Safety and privacy

- **Verified downloads.** The one-line installers check the executable's SHA-256 against the `SHA256SUMS.txt` published with each release, and refuse to run on a mismatch. Widevine downloads are checked against the SHA-256 (Google) or SHA-512 (Mozilla) hash the update server publishes, and a ZIP entry that tries to write outside its folder is refused.
- **No telemetry.** The tool collects nothing and sends nothing about you. It only goes online to:
  - download itself from GitHub (one-line installers only),
  - download Widevine, only if no copy exists on your computer (or with `--latest` / `--force-download`): Google's update server, then Mozilla's, then a Chrome download,
  - check GitHub for a newer version of the fixer (2.5-second limit; skipped by the one-liners; set `HELIUM_DRM_FIXER_NO_UPDATE_CHECK=1` to turn it off).

  `--offline` turns off every download. The DRM check after installing uses a local page on `127.0.0.1` and needs no internet.
- **No admin rights, normally.** Everything happens in your user folders, including the `--auto` scheduled task. Administrator rights are only needed if Helium is installed for all users in `C:\Program Files`.
- **Never touches your Helium profile to test.** Verification uses a temporary profile that is deleted right after.
- **Changes only one folder.** Your other browsers' Widevine copies are only read, never modified. In Helium, only the `WidevineCdm` folder is written.
- **Asks before closing Helium.** It closes Helium the normal way so your session is saved, and restores your tabs when it reopens.
- **Open source.** Every line is in this repository, under the MIT license.

---

## ⚠️ Limitations

This tool gives Helium a working Widevine CDM. It does **not** change Helium's Chromium build, browser identity, codecs, HDCP support, Widevine certification level, or Verified Media Path (VMP) status.

- **Usually works:** sites that accept any browser with Widevine, for example YouTube movies and Crunchyroll.
- **May fail or be limited:** services with strict checks, such as Netflix or Amazon Prime Video. They can require an approved browser, VMP signatures, hardware-backed security or output protection that no copied CDM can provide, and may limit video quality where they do play.
- **macOS:** basic support is in the code (copy plus re-signing Helium.app), but it isn't the focus and isn't tested.

---

## 🩺 Troubleshooting

<details>
<summary><b>"Helium browser not found"</b></summary>

Install Helium from [helium.computer](https://helium.computer/). If it's somewhere unusual, for example a portable copy on another drive:

- open Helium and run the tool again (it finds a running Helium), or
- pass `--helium-path "D:\path\to\helium"`.

</details>

<details>
<summary><b>"WidevineCdm is in use"</b></summary>

Helium is still running and you chose not to close it. Run the tool again and answer **Y**, or add `--yes`. On Windows, also check the system tray for a background Helium.

</details>

<details>
<summary><b>"No Widevine found" / "Failed to find or download Widevine"</b></summary>

No browser or app on your computer has Widevine yet, and all three downloads (Google, Mozilla, Chrome) failed, often because of a firewall or proxy. Check that `update.googleapis.com` and `dl.google.com` are reachable. Or install any supported browser, play a DRM video in it once so it downloads Widevine, and run the tool again. `--list-sources` shows what it can see. If you used `--offline`, run without it.

</details>

<details>
<summary><b>"Failed to copy WidevineCdm" / "Permission denied"</b></summary>

- **Windows:** Helium is probably installed for all users; use an Administrator PowerShell.
- **Linux:** check that you own `~/.config/net.imput.helium`.

</details>

<details>
<summary><b>"Couldn't verify" (exit code 2)</b></summary>

Widevine was installed, but the invisible test run of Helium didn't confirm it. Restart Helium and try a DRM site; if it plays, all is well (some systems block starting Helium in the background). If not, try a different copy: `--list-sources`, then for example `--from edge`, or `--force-download` for a fresh copy from Google.

</details>

<details>
<summary><b>The fix ran, but a site still doesn't play</b></summary>

1. Fully restart Helium. On Windows, check the system tray too.
2. Run `fix-helium-drm --status`: it asks Helium whether DRM works. You can also check by hand: open DevTools (F12) on any `https://` page and run
   `navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{initDataTypes: ['cenc'], videoCapabilities: [{contentType: 'video/mp4; codecs="avc1.42E01E"'}]}]).then(() => 'supported', e => e.message)`.
   It should print `supported`.
3. Try a simpler DRM test first, for example the Widevine demo at [bitmovin.com/demos/drm](https://bitmovin.com/demos/drm).
4. If the simple test works but a particular service doesn't, see [Limitations](#%EF%B8%8F-limitations): that service is probably checking more than Widevine.
5. Try a different Widevine: `fix-helium-drm --list-sources`, then for example `--from edge`, or the newest from Google with `--latest`.

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
No. Once Widevine is copied, Helium has its own copy. You don't even need Chrome to start with: the fixer uses another browser's copy, or downloads just the ~20 MB Widevine package from Google.

**Where does a downloaded Widevine come from?**
From Google's own servers, through the same component-update service Chrome, Edge and Brave use to install Widevine. Mozilla's update server (Firefox's route) is the backup, and it points at the same Google packages.

**Do I have to run it again after Helium updates?**
On Linux, no. On Windows, either run it again or turn on `--auto` once and forget about it.

**Why is the executable ~100 MB?**
It's a single self-contained file that includes the Bun runtime, so you don't need to install anything. The one-liner deletes it after running.

**Does it work with Helium's portable version?**
Yes. That's one of the tested setups. With several Heliums (installed and portable), use `--all`.

**Does it work on ARM?**
Yes. It reads Helium's CPU type and gets the matching Widevine, downloading the ARM64 build from Google if needed. The Windows executable is x64 and runs on Windows on ARM through emulation; Linux has a native ARM64 build.

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
lib/helium.ts             Every Helium install: folder, CPU, version, install/remove
lib/widevine.ts           Widevine sources, validation, CPU detection, Firefox conversion
lib/widevine-download.ts  Widevine from Google / Mozilla update servers (Chrome as fallback)
lib/zip.ts                Built-in ZIP and CRX3 reader
lib/verify.ts             Invisible in-Helium DRM check via DevTools Protocol
lib/autofix.ts            Windows scheduled task + window-less copy for --auto
lib/console.ts            Double-click detection, prompts
lib/update-check.ts       "New version available" notice
lib/paths.ts              Finding Chrome and Helium on each OS
lib/windows.ts            Registry, running processes, closing/reopening programs
lib/chrome-downloader.ts  Chrome download (last resort), download helper with progress
lib/deb.ts                Minimal .deb (ar) reader
lib/extractor.ts          Bundled 7-Zip extraction (Windows)
install.ps1 / install.sh  One-line installers
packaging/                Scoop, winget and AUR manifests (regenerated on every release)
scripts/release.ts        One-command release
scripts/packaging.ts      Writes the package-manager manifests
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

- [**Helium**](https://helium.computer/) by imput — the privacy-focused browser this tool is made for
- [**Bun**](https://bun.sh/) — runtime and single-file compiler
- [**Bush2021/chrome_installer**](https://github.com/Bush2021/chrome_installer) — offline Chrome installers used for the Windows download
- [**7-Zip**](https://www.7-zip.org/) by Igor Pavlov — extraction on Windows
- [commander](https://github.com/tj/commander.js), [chalk](https://github.com/chalk/chalk), [ora](https://github.com/sindresorhus/ora), [pino](https://github.com/pinojs/pino) and [browser-finder](https://github.com/agent-infra/browser) — the building blocks

<div align="center">

**If this fixed Helium for you, consider giving the repo a ⭐ — it helps other Helium users find it.**

</div>
