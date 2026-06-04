#Requires -Version 5.1
<#
.SYNOPSIS
  Reports common prerequisites for developing the Claude Code source tree.
  Does not modify the system.
#>

Write-Host "Claude Code src - dev environment check" -ForegroundColor Cyan
Write-Host ""

function Test-Tool {
  param(
    [string]$Label,
    [string]$CommandName,
    [string[]]$VersionArgs = @('--version')
  )
  $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Host "[miss] $Label - not found in PATH" -ForegroundColor Yellow
    return
  }
  try {
    $ver = & $CommandName @VersionArgs 2>&1
    Write-Host "[ok]   $Label - $ver" -ForegroundColor Green
  } catch {
    Write-Host "[ok]   $Label - found at $($cmd.Source)" -ForegroundColor Green
  }
}

$srcDir = Split-Path -Parent $PSScriptRoot
$repoDir = Split-Path -Parent $srcDir
$hasPkg = Test-Path (Join-Path $repoDir 'package.json')
if ($hasPkg) {
  Write-Host '[ok]   package.json present next to src (full repo layout)' -ForegroundColor Green
} else {
  Write-Host '[info] No package.json in parent folder - src-only checkout; see SETUP.md' -ForegroundColor Yellow
}

Test-Tool -Label 'Git' -CommandName 'git'
Test-Tool -Label 'Node.js' -CommandName 'node'
Test-Tool -Label 'Bun' -CommandName 'bun'

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
if (-not $hasPkg) {
  Write-Host '  - To RUN the product: use the official installer (SETUP.md, section A).'
  Write-Host '  - To BUILD this source: obtain the full repo with package.json, then bun install at repo root.'
} else {
  Write-Host '  - From repo root: bun install, then follow upstream build docs.'
}
