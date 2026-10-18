# Helium DRM Fixer

A CLI tool that fixes DRM issues in the [Helium browser](https://helium.is/) by copying WidevineCdm from Chrome. Works on **Windows** and **Linux** (and macOS).

## Why Helium DRM?

Helium browser often has issues with DRM-protected content because it doesn't include WidevineCdm. This tool copies WidevineCdm from your Chrome installation to Helium, enabling basic Widevine support for sites that accept it. If Chrome isn't installed, it downloads it for you.

## Quick start

Download the file for your system from the [latest release](https://github.com/OctavianAdv/helium-drm-fixer/releases/latest):

| System | File |
| --- | --- |
| Windows (x64, also runs on ARM) | `fix-helium-drm-windows-x64.exe` |
| Linux (x64) | `fix-helium-drm-linux-x64` |
| Linux (ARM64) | `fix-helium-drm-linux-arm64` |

**Close Helium first**, then run the tool.

### Windows

Open PowerShell in the folder where you downloaded it and run:

```powershell
.\fix-helium-drm-windows-x64.exe
```

If Helium is installed for all users (in `C:\Program Files`), run the terminal as Administrator.

### Linux

```bash
chmod +x fix-helium-drm-linux-x64
./fix-helium-drm-linux-x64
```

No `sudo` needed. Launch Helium at least once before running the tool, so its profile folder exists.

Restart Helium when it's done.

## Run from source

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run cli.ts
```

## How it works

1. **Finds Chrome's WidevineCdm.** Looks for Chrome in its usual install folders (picking the newest version). If Chrome isn't installed, it downloads it:
   - Windows: the official uncompressed installer, via [Bush2021/chrome_installer](https://github.com/Bush2021/chrome_installer), unpacked with a bundled 7-Zip.
   - Linux (x64): Google's official `.deb` package, unpacked without `dpkg` (only `tar` and `xz` are needed), so it works on any distro.
2. **Finds Helium.**
   - Windows: `%LOCALAPPDATA%\imput\Helium\Application\<version>` (or the same path under `Program Files`).
   - Linux: Helium's profile folder, `~/.config/net.imput.helium`. This works for every install type: AppImage, tarball or distro package.
3. **Copies WidevineCdm.**
   - Windows: into Helium's newest version folder.
   - Linux: into `<profile>/WidevineCdm/<version>/`, plus the hint file Chromium uses to load a component-updated CDM.

Downloads are cached in your temp folder and verified by checksum, so running the tool again is fast.

## Options

```
--check               Check if the fix can be applied, without changing anything
--dry-run             Show what would be copied, without changing anything
--verbose, --debug    Show detailed logs
--chrome-path <path>  Use this WidevineCdm folder instead of finding Chrome
--helium-path <path>  Helium version folder (Windows/macOS) or profile folder (Linux)
--force-download      Download Chrome again even if it is cached
```

### Custom paths

If the tool can't find your browsers, point it at them:

```powershell
# Windows
.\fix-helium-drm-windows-x64.exe --chrome-path "C:\Program Files\Google\Chrome\Application\143.0.7499.170\WidevineCdm" --helium-path "$env:LOCALAPPDATA\imput\Helium\Application\143.0.7499.170"
```

```bash
# Linux
./fix-helium-drm-linux-x64 --chrome-path /opt/google/chrome/WidevineCdm --helium-path ~/.config/net.imput.helium
```

## Limitations

This tool only makes Helium able to load Widevine. It does not change Helium's Chromium build, browser identity, codecs, HDCP support, Widevine certification, or Verified Media Path status.

That is why DRM can work on some sites, such as YouTube or Crunchyroll, but still fail on stricter services such as Netflix or Amazon Prime Video. Those services can require an approved browser, output protection, VMP, or other license-server checks that copying `WidevineCdm` cannot satisfy.

Google doesn't publish Chrome for ARM Linux, so on ARM64 Linux the automatic download isn't available. Use `--chrome-path` with the WidevineCdm folder of another Chromium browser.

## Troubleshooting

### "Helium browser not found" / "Could not find the Helium profile folder"
Install Helium from [helium.is](https://helium.is/). On Linux, launch it once so it creates its profile folder.

### "WidevineCdm is in use"
Helium is still running. Close every Helium window (check the system tray on Windows) and run the tool again.

### "Chrome not found"
The tool downloads Chrome automatically. If that fails, install Chrome from [google.com/chrome](https://www.google.com/chrome/).

### "Failed to copy WidevineCdm"
Make sure you have write permissions to the Helium folder. On Windows with an all-users install, run as Administrator.

## Development

```bash
bun test            # Run tests
bun run typecheck   # Type checking
bun run build       # Build an executable for this system
bun run build:all   # Build Windows x64, Linux x64 and Linux ARM64 executables into ./dist
```

### Releasing

One command does the whole flow:

```bash
bun run release patch   # 1.0.0 -> 1.0.1 (or: minor, major, 1.2.3)
```

It checks that everything is committed and up to date, runs the type check and tests, bumps the version in `package.json`, and builds the Windows and Linux executables with SHA-256 checksums. Then it commits, tags and pushes, and creates the GitHub release: notes come from the `feat:` / `fix:` commits since the last release, with the executables attached.

It uses the GitHub login git already saved (or a `GITHUB_TOKEN`). Pushing a `v*` tag also makes GitHub Actions rebuild the same files and re-upload them to that release. You can also run that from the Actions tab for any tag.

## License

This project is private.

## Credits

- [Helium Browser](https://helium.is/) - The browser this tool fixes
- [Bun](https://bun.sh/) - Fast JavaScript runtime
