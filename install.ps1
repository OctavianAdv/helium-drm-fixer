# Helium DRM Fixer - Windows one-line installer
#
#   irm https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.ps1 | iex
#
# With options (e.g. --dry-run, --yes, --helium-path "D:\Helium"):
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/OctavianAdv/helium-drm-fixer/main/install.ps1))) --yes
#
# Downloads the latest fixer from GitHub releases, checks its SHA-256, runs
# it, and removes it again. The fixer finds Helium and Widevine by itself.

function Invoke-HeliumDrmFixer {
    param([string[]]$FixerArgs)

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = 'OctavianAdv/helium-drm-fixer'
    $asset = 'fix-helium-drm-windows-x64.exe'
    $base = "https://github.com/$repo/releases/latest/download"

    $dir = Join-Path $env:TEMP 'helium-drm-fixer'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir $asset
    $sumsFile = Join-Path $dir 'SHA256SUMS.txt'

    Write-Host ''
    Write-Host 'Helium DRM Fixer' -ForegroundColor Cyan
    Write-Host 'Downloading the latest version...' -ForegroundColor DarkGray

    try {
        Invoke-WebRequest -Uri "$base/$asset" -OutFile $exe -UseBasicParsing
        Invoke-WebRequest -Uri "$base/SHA256SUMS.txt" -OutFile $sumsFile -UseBasicParsing
    } catch {
        Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
        return
    }

    $expected = (Get-Content $sumsFile | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }) -replace '\s.*$', ''
    $actual = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLower()
    if (-not $expected -or $expected.ToLower() -ne $actual) {
        Write-Host 'Checksum mismatch - the download is corrupted or was tampered with. Aborting.' -ForegroundColor Red
        Remove-Item -Force $exe, $sumsFile -ErrorAction SilentlyContinue
        return
    }
    Write-Host 'Checksum verified.' -ForegroundColor DarkGray

    # Show the fixer's emoji and progress bar correctly
    # This is always the latest version, so skip its own update check
    $env:HELIUM_DRM_FIXER_NO_UPDATE_CHECK = '1'
    $previousEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    try {
        & $exe @FixerArgs
        $code = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $previousEncoding
        Remove-Item Env:HELIUM_DRM_FIXER_NO_UPDATE_CHECK -ErrorAction SilentlyContinue
        Remove-Item -Force $exe, $sumsFile -ErrorAction SilentlyContinue
    }

    if ($code -ne 0) {
        Write-Host "The fixer exited with code $code. Run it again with --verbose for details:" -ForegroundColor Yellow
        Write-Host "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$repo/main/install.ps1))) --verbose" -ForegroundColor DarkGray
    }
}

Invoke-HeliumDrmFixer -FixerArgs $args
