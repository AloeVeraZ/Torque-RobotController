# Torque one-line installer for Windows x64 (PowerShell):
#   irm https://raw.githubusercontent.com/AloeVeraZ/Torque-RobotController/main/install.ps1 | iex
# Downloads the latest stable Setup from GitHub, checks its SHA-256, installs it for this user
# (no administrator account), and opens the app. $env:DECK_DOWNLOAD_ONLY='1' stops after the verified download.
& {
  if ($args.Count) { throw 'Installation uses Main only. Choose Testing from Updates after installing.' }
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # Windows PowerShell downloads far faster without the progress bar
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $repo = 'AloeVeraZ/Torque-RobotController'
  Write-Host 'Finding the latest Main release ...'
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'DeckDriverStation-Installer' } -TimeoutSec 30
  if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v([0-9]+\.[0-9]+\.[0-9]+)$') { throw 'No valid Main release was found. Testing builds are not installed by this command.' }
  $version = $Matches[1]
  $base = "https://github.com/$repo/releases/download/v$version"
  $file = "DeckDriverStation-$version-Windows-Setup.exe"
  $installed = Join-Path $env:LOCALAPPDATA 'DeckDriverStation'
  $keep = $env:DECK_DOWNLOAD_ONLY -eq '1'

  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installed, [StringComparison]::OrdinalIgnoreCase) }
  if ($running -and -not $keep) { Write-Host 'Close Torque, then run this command again.' -ForegroundColor Yellow; return }

  $stage = Join-Path ([IO.Path]::GetTempPath()) ('deck-driver-station-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    Write-Host "Downloading $file from github.com/$repo ..."
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile (Join-Path $stage $file)
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file.sha256" -OutFile (Join-Path $stage "$file.sha256")
    Write-Host 'Checking download ...'
    $expected = ((Get-Content -LiteralPath (Join-Path $stage "$file.sha256") -Raw).Trim() -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath (Join-Path $stage $file) -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw 'The download did not match its checksum. Nothing was installed.' }
    if ($keep) { Write-Host "Verified download: $(Join-Path $stage $file)"; return }

    Write-Host 'Installing ...'
    $setup = Start-Process -FilePath (Join-Path $stage $file) -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($setup.ExitCode -ne 0) { throw "Setup exited with code $($setup.ExitCode)." }
    Write-Host 'Installed Torque. Opening it now; shortcuts are on the desktop and Start menu.' -ForegroundColor Green
    Start-Process -FilePath (Join-Path $installed 'DeckDriverStation.exe')
  } finally {
    if (-not $keep) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
