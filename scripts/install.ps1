#Requires -Version 5.1
<#
.SYNOPSIS
  Install CodeGuru CLI dependencies on Windows.
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SettingsDir = Join-Path $env:USERPROFILE '.codeguru'
$SettingsFile = Join-Path $SettingsDir 'settings.json'
$ExampleSettings = Join-Path $RepoRoot 'scripts\settings.example.json'

function Write-Info($msg)  { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host $msg -ForegroundColor Yellow }

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Node {
  if (Test-Command node) {
    $version = (& node --version) -replace '^v', ''
    $major = [int]($version.Split('.')[0])
    if ($major -ge 18) {
      Write-Ok "[ok] Node.js v$version"
      return
    }
    Write-Warn "Node.js v$version found but 18+ is required"
  }

  Write-Info "Node.js 18+ not found."
  if (Test-Command winget) {
    Write-Info "Installing fnm via winget..."
    winget install Schniz.fnm --accept-package-agreements --accept-source-agreements
    fnm install 22
    fnm use 22
    fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
  } else {
    throw "Install Node.js 18+ manually: https://nodejs.org/"
  }
  Write-Ok "[ok] Node.js $(node --version)"
}

function Ensure-Bun {
  if (Test-Command bun) {
    Write-Ok "[ok] Bun $(bun --version)"
    return
  }

  Write-Info "Bun not found - installing..."
  if (Test-Command winget) {
    winget install Oven-sh.Bun --accept-package-agreements --accept-source-agreements
  } else {
    npm install -g bun
  }
  if (-not (Test-Command bun)) {
    throw "Bun install failed. See https://bun.sh/docs/installation"
  }
  Write-Ok "[ok] Bun $(bun --version)"
}

function Install-NpmDeps {
  Set-Location $RepoRoot
  Write-Info "Installing npm dependencies..."
  npm install --legacy-peer-deps
  Write-Info "Pinning React 19 packages..."
  npm install react@^19.0.0 react-reconciler@0.34.0-canary-ed69815c-20260323 --legacy-peer-deps
  Write-Ok "[ok] Dependencies installed"
}

function Ensure-Settings {
  if (Test-Path $SettingsFile) {
    Write-Ok "[ok] Settings already exist at $SettingsFile"
    return
  }
  New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
  Copy-Item $ExampleSettings $SettingsFile
  Write-Ok "[ok] Created $SettingsFile from template - edit and add your API key"
}

Write-Info "CodeGuru install (Windows)"
Write-Info "Repo: $RepoRoot"
Write-Host ""

if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  throw "package.json not found. Run from the CodeGuru repo root."
}

Ensure-Node
Ensure-Bun
Install-NpmDeps
Ensure-Settings

Write-Host ""
Write-Ok "Install complete."
Write-Info "Next steps:"
Write-Info "  1. Edit $SettingsFile and set CODEGURU_AUTH_TOKEN"
Write-Info "  2. bun run dev"
Write-Info "  3. python scripts/check-dev-environment.py  (optional check)"
