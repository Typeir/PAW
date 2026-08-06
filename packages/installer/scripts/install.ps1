# PAW installer (Windows)
#
# Downloads the paw executable to %USERPROFILE%\.paw\bin and puts it on PATH by
# invoking the binary's own `paw-setup path` (which persists the per-user Path via
# the .NET environment API — never setx). No admin required.
#
# Usage:  irm https://<host>/install.ps1 | iex
#         $env:PAW_VERSION = 'v1.0.0'; irm https://<host>/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$version = if ($env:PAW_VERSION) { $env:PAW_VERSION } else { 'latest' }
$binDir  = Join-Path $env:USERPROFILE '.paw\bin'
$target  = Join-Path $binDir 'paw-setup.exe'
$url     = "https://github.com/typeir/paw/releases/download/$version/paw-setup-windows-x64.exe"

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $target

# Activate PATH through the binary itself (persisted + broadcast, no logout).
& $target path --bin="$binDir"
Write-Host "Installed paw to $binDir. Open a new terminal and run: paw-setup path --dry-run"
