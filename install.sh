#!/usr/bin/env bash
# Helium DRM Fixer - Linux one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.sh | bash
#
# With options (e.g. --dry-run, --helium-path ~/.config/net.imput.helium):
#
#   curl -fsSL https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.sh | bash -s -- --dry-run
#
# Downloads the latest fixer from GitHub releases, checks its SHA-256, runs
# it, and removes it again. The fixer finds Helium and Widevine by itself.
set -euo pipefail

REPO="OctavianAdv/helium-drm-fixer"
BASE="https://github.com/$REPO/releases/latest/download"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
dim() { printf '\033[2m%s\033[0m\n' "$*"; }

main() {
  if [ "$(uname -s)" != "Linux" ]; then
    red "This installer is for Linux. On Windows, run in PowerShell:"
    echo "  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex"
    exit 1
  fi

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) red "Unsupported CPU: $(uname -m) (x86_64 and arm64 are supported)"; exit 1 ;;
  esac
  asset="fix-helium-drm-linux-$arch"

  if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL "$1" -o "$2"; }
  elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q "$1" -O "$2"; }
  else
    red "Please install curl or wget first."
    exit 1
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  printf '\n\033[36mHelium DRM Fixer\033[0m\n'
  dim "Downloading the latest version..."
  fetch "$BASE/$asset" "$tmp/$asset"
  fetch "$BASE/SHA256SUMS.txt" "$tmp/SHA256SUMS.txt"

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp" && grep " $asset\$" SHA256SUMS.txt | sha256sum -c --status) || {
      red "Checksum mismatch - the download is corrupted or was tampered with. Aborting."
      exit 1
    }
    dim "Checksum verified."
  fi

  chmod +x "$tmp/$asset"
  # This is always the latest version, so skip its own update check
  export HELIUM_DRM_FIXER_NO_UPDATE_CHECK=1
  # Read answers from the terminal, since stdin is this script when piped
  if (: </dev/tty) 2>/dev/null; then
    "$tmp/$asset" "$@" </dev/tty
  else
    "$tmp/$asset" "$@"
  fi
}

main "$@"
