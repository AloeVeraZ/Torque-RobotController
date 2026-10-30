# Offline Windows bootstrap check: no network calls or installers are executed.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '../install.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('deck-bootstrap-check-' + [guid]::NewGuid())
$oldLocal = $env:LOCALAPPDATA
$oldDownload = $env:DECK_DOWNLOAD_ONLY
$global:DeckBootstrap_bytes = [Text.Encoding]::UTF8.GetBytes('verified installer fixture')
$global:DeckBootstrap_hash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($global:DeckBootstrap_bytes))).Replace('-', '').ToLowerInvariant()
$global:DeckBootstrap_calls = [Collections.Generic.List[string]]::new()
$global:DeckBootstrap_tag = 'v9.8.7'
$global:DeckBootstrap_corrupt = $false
function Invoke-RestMethod { param($Uri, $Headers, $TimeoutSec)
  if ($Uri -notlike 'https://api.github.com/*/releases/latest') { throw 'Unexpected release endpoint' }
  @{ tag_name = $global:DeckBootstrap_tag; prerelease = $global:DeckBootstrap_tag.StartsWith('testing-'); draft = $false }
}
function Invoke-WebRequest { param([switch]$UseBasicParsing, $Uri, $OutFile)
  if ($Uri -notlike 'https://github.com/AloeVeraZ/Torque-RobotController/releases/download/v9.8.7/DeckDriverStation-9.8.7-Windows-Setup.exe*') { throw 'Unexpected asset URL' }
  if ($Uri.EndsWith('.sha256')) { [IO.File]::WriteAllText($OutFile, "$global:DeckBootstrap_hash  DeckDriverStation-9.8.7-Windows-Setup.exe`r`n") }
  elseif ($global:DeckBootstrap_corrupt) { [IO.File]::WriteAllText($OutFile, 'corrupt') }
  else { [IO.File]::WriteAllBytes($OutFile, $global:DeckBootstrap_bytes) }
}
function Get-Process { param($ErrorAction) @() }
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru, [switch]$Wait)
  $global:DeckBootstrap_calls.Add([IO.Path]::GetFileName($FilePath))
  if ($PassThru) {
    if ($ArgumentList -ne '/S' -or -not $Wait) { throw 'Expected silent installer and completion wait' }
    return @{ ExitCode = 0 }
  }
}
function Must-Reject {
  $rejected = $false
  try { & $installer } catch { $rejected = $true }
  if (-not $rejected) { throw 'Invalid release/download accepted' }
}
try {
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $env:LOCALAPPDATA = $fixture
  $env:DECK_DOWNLOAD_ONLY = ''
  & $installer
  if ($global:DeckBootstrap_calls.Count -ne 2 -or $global:DeckBootstrap_calls[0] -ne 'DeckDriverStation-9.8.7-Windows-Setup.exe' -or $global:DeckBootstrap_calls[1] -ne 'DeckDriverStation.exe') { throw 'Expected exactly one install followed by app launch' }
  $global:DeckBootstrap_calls.Clear()
  $global:DeckBootstrap_tag = 'testing-v9.8.7'
  Must-Reject
  $global:DeckBootstrap_tag = 'v9.8.7'
  $global:DeckBootstrap_corrupt = $true
  Must-Reject
  if ($global:DeckBootstrap_calls.Count) { throw 'Failed verification launched an executable' }
  Write-Host 'PASS: Windows Main-only future assets, CRLF checksum verification, silent install then launch, prerelease and corruption refusal.'
} finally {
  $env:LOCALAPPDATA = $oldLocal
  $env:DECK_DOWNLOAD_ONLY = $oldDownload
  $resolved = [IO.Path]::GetFullPath($fixture)
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolved.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('deck-bootstrap-check-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
