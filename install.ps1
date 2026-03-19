# AgentSkills install script for Windows
# Usage: irm https://raw.githubusercontent.com/chrlsio/agent-skills/main/install.ps1 | iex
#
# Optional variables (set before running):
#   $Version = "0.1.1"   # Install specific version
#   $DryRun = $true      # Preview commands without executing

if (-not $Version) { $Version = "" }
if (-not $DryRun) { $DryRun = $false }

$ErrorActionPreference = "Stop"

$Repo = "chrlsio/agent-skills"
$AppName = "AgentSkills"
$GithubApi = "https://api.github.com/repos/$Repo/releases"
$script:ReleaseVersion = ""
$script:DownloadUrl = ""
$script:Filename = ""
$script:SelectedAssetName = ""

function Write-ColorOutput {
  param([string]$ForegroundColor, [string]$Message)
  Write-Host $Message -ForegroundColor $ForegroundColor
}

function Info { Write-ColorOutput "Cyan" "[INFO] $args" }
function Success { Write-ColorOutput "Green" "[OK] $args" }
function Warn { Write-ColorOutput "Yellow" "[WARN] $args" }
function Script-Error { Write-ColorOutput "Red" "[ERROR] $args" }

function Resolve-Arch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -match "ARM64") { return "arm64" }
  if ($arch -match "AMD64|X86_64") { return "x64" }
  throw "Unsupported architecture: $arch"
}

function Normalize-Version {
  param([string]$Value)
  if (-not $Value) { return "" }
  return ($Value -replace "^v", "")
}

function Get-ReleaseVersion {
  if ($Version) {
    $script:ReleaseVersion = Normalize-Version $Version
    Info "Using specified version: v$($script:ReleaseVersion)"
    return $true
  }

  Info "Fetching latest version..."

  try {
    $release = Invoke-RestMethod -Uri "$GithubApi/latest" -Headers @{
      "User-Agent" = "agentskills-installer"
      "Accept"     = "application/vnd.github+json"
    } -TimeoutSec 10
    $script:ReleaseVersion = Normalize-Version $release.tag_name
    if ($script:ReleaseVersion) {
      Info "Latest version: v$($script:ReleaseVersion)"
      return $true
    }
  } catch {
    Warn "GitHub API failed, trying fallback..."
  }

  try {
    Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -MaximumRedirection 0 -ErrorAction SilentlyContinue -UseBasicParsing | Out-Null
  } catch {
    $redirectUrl = $_.Exception.Response.Headers.Location
    if ($redirectUrl -and $redirectUrl -match "/tag/v?(.+)$") {
      $script:ReleaseVersion = Normalize-Version $Matches[1]
      Info "Latest version (from redirect): v$($script:ReleaseVersion)"
      return $true
    }
  }

  Script-Error "Failed to determine latest version."
  return $false
}

function Build-FallbackAssets {
  $base = "https://github.com/$Repo/releases/download/v$($script:ReleaseVersion)"
  return @(
    @{ name = "AgentSkills_$($script:ReleaseVersion)_x64-setup.exe"; url = "$base/AgentSkills_$($script:ReleaseVersion)_x64-setup.exe" },
    @{ name = "AgentSkills_$($script:ReleaseVersion)_x64_en-US.msi"; url = "$base/AgentSkills_$($script:ReleaseVersion)_x64_en-US.msi" },
    @{ name = "AgentSkills_$($script:ReleaseVersion)_arm64-setup.exe"; url = "$base/AgentSkills_$($script:ReleaseVersion)_arm64-setup.exe" },
    @{ name = "AgentSkills_$($script:ReleaseVersion)_arm64_en-US.msi"; url = "$base/AgentSkills_$($script:ReleaseVersion)_arm64_en-US.msi" }
  )
}

function Get-Assets {
  $tagApi = "$GithubApi/tags/v$($script:ReleaseVersion)"

  try {
    Info "Fetching release metadata for v$($script:ReleaseVersion)..."
    $release = Invoke-RestMethod -Uri $tagApi -Headers @{
      "User-Agent" = "agentskills-installer"
      "Accept"     = "application/vnd.github+json"
    } -TimeoutSec 10

    if ($release.assets -and $release.assets.Count -gt 0) {
      return $release.assets | ForEach-Object {
        @{
          name = $_.name
          url = $_.browser_download_url
        }
      }
    }
  } catch {
    Warn "Release metadata unavailable, using fallback asset names."
  }

  return Build-FallbackAssets
}

function Select-Asset {
  param(
    [array]$Assets,
    [string]$Arch
  )

  $candidates = $Assets | Where-Object { $_.url -match "\.exe($|\?)|\.msi($|\?)" }
  if (-not $candidates) { throw "No Windows installable assets found." }

  if ($Arch -eq "arm64") {
    $archCandidates = $candidates | Where-Object { $_.name -match "arm64|aarch64" }
  } else {
    $archCandidates = $candidates | Where-Object { $_.name -match "x64|x86_64|amd64" }
  }

  if (-not $archCandidates) {
    if ($Arch -eq "arm64") {
      Warn "No native ARM64 asset found; falling back to x64 installer."
    }
    $archCandidates = $candidates
  }

  $preferred = $archCandidates | Where-Object { $_.name -match "\.exe($|\?)" } | Select-Object -First 1
  if (-not $preferred) {
    $preferred = $archCandidates | Where-Object { $_.name -match "\.msi($|\?)" } | Select-Object -First 1
  }
  if (-not $preferred) { throw "Unable to select installer asset." }

  $script:SelectedAssetName = $preferred.name
  $script:DownloadUrl = $preferred.url
  $script:Filename = [System.IO.Path]::GetFileName($script:DownloadUrl)
}

function Install-App {
  $downloadPath = Join-Path ([System.IO.Path]::GetTempPath()) $script:Filename

  Info "Detected platform: windows/$((Resolve-Arch))"
  Info "Selected asset: $($script:SelectedAssetName)"
  Info "Downloading to: $downloadPath"

  if ($DryRun) {
    Write-ColorOutput "Yellow" "[DRY-RUN] Invoke-WebRequest -Uri $($script:DownloadUrl) -OutFile $downloadPath"
  } else {
    Invoke-WebRequest -Uri $script:DownloadUrl -OutFile $downloadPath -UseBasicParsing
    if (-not (Test-Path $downloadPath)) { throw "Download failed: file not found." }
  }

  if ($downloadPath -match "\.exe($|\?)") {
    if ($DryRun) {
      Write-ColorOutput "Yellow" "[DRY-RUN] Start-Process -FilePath $downloadPath -ArgumentList /S -Wait"
    } else {
      $proc = Start-Process -FilePath $downloadPath -ArgumentList "/S" -Wait -PassThru
      if ($proc.ExitCode -ne 0) { throw "NSIS installer exited with code $($proc.ExitCode)" }
    }
  } elseif ($downloadPath -match "\.msi($|\?)") {
    $args = "/i `"$downloadPath`" /qn /norestart"
    if ($DryRun) {
      Write-ColorOutput "Yellow" "[DRY-RUN] Start-Process -FilePath msiexec.exe -ArgumentList $args -Wait"
    } else {
      $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru
      if ($proc.ExitCode -ne 0) { throw "MSI installer exited with code $($proc.ExitCode)" }
    }
  } else {
    throw "Unsupported installer format: $downloadPath"
  }

  if (-not $DryRun -and (Test-Path $downloadPath)) {
    Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
    Info "Cleaned up installer file."
  }
}

Write-Host ""
Write-ColorOutput "Cyan" "====================================="
Write-ColorOutput "Cyan" "      $AppName Installer"
Write-ColorOutput "Cyan" "====================================="
Write-Host ""

try {
  if (-not (Get-ReleaseVersion)) { throw "Unable to get release version." }
  $arch = Resolve-Arch
  $assets = Get-Assets
  Select-Asset -Assets $assets -Arch $arch
  Install-App

  Write-Host ""
  Success "Installation complete!"
  Write-Host ""
} catch {
  Script-Error $_
  exit 1
}
