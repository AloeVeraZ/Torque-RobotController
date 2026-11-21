param([string]$PlanPath)
$ErrorActionPreference = 'Stop'
Write-Output 'Starting update installer'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
function Restart-App([string]$Root) {
    Start-Process -FilePath (Join-Path $Root 'runtime/electron.exe') -ArgumentList ('"'+(Join-Path $Root 'app')+'"') -WorkingDirectory $Root -WindowStyle Hidden
}
# An update from the release's Windows installer: app and runtime move aside, the installer runs silently into the same
# folder, and the old copy comes back if it fails or installs anything but the expected version.
if ($plan.setup) {
    $setup = [IO.Path]::GetFullPath($plan.setup)
    $destination = [IO.Path]::GetFullPath($plan.destination).TrimEnd('\')
    $stage = [IO.Path]::GetFullPath($plan.stage).TrimEnd('\') + '\'
    if (!$setup.StartsWith($stage, [StringComparison]::OrdinalIgnoreCase) -or !$setup.EndsWith('-Windows-Setup.exe')) { throw 'Update installer is outside staging' }
    if (!(Test-Path -LiteralPath (Join-Path $destination 'app/package.json'))) { throw 'Installed app is missing' }
    Wait-Process -Id $plan.pid -Timeout 60 -ErrorAction SilentlyContinue
    if (Get-Process -Id $plan.pid -ErrorAction SilentlyContinue) { throw 'App did not exit; update cancelled' }
    Write-Output 'App exited; running the installer'
    $backup = Join-Path $stage 'previous'
    New-Item -ItemType Directory -Path $backup | Out-Null
    $moved = @()
    try {
        foreach ($item in @('app','runtime')) {
            $done = $false
            for ($attempt=0; $attempt -lt 20; $attempt++) {
                try { Move-Item -LiteralPath (Join-Path $destination $item) -Destination $backup; $done=$true; break } catch { Start-Sleep -Milliseconds 500 }
            }
            if (!$done) { throw "Could not replace $item" }
            $moved += $item
        }
        # NSIS: /S is silent and /D (last, unquoted) is the install folder.
        $run = Start-Process -FilePath $setup -ArgumentList @('/S', ('/D='+$destination)) -Wait -PassThru -WindowStyle Hidden
        if ($run.ExitCode -ne 0) { throw ('The installer failed with exit code '+$run.ExitCode) }
        $installed = (Get-Content -LiteralPath (Join-Path $destination 'app/package.json') -Raw | ConvertFrom-Json).version
        if ($installed -ne $plan.version) { throw ('The installer put version '+$installed+' in place, not '+$plan.version) }
        if (!(Test-Path -LiteralPath (Join-Path $destination 'runtime/electron.exe'))) { throw 'The update runtime is missing' }
    } catch {
        Write-Output ('Update failed, restoring the previous version: '+$_.Exception.Message)
        foreach ($item in $moved) {
            $target = Join-Path $destination $item
            if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination (Join-Path $stage ('failed-'+$item)) }
            Move-Item -LiteralPath (Join-Path $backup $item) -Destination $destination
        }
        Restart-App $destination
        throw
    }
    # Field and robot CAD prepared on this computer is never in a release; keep it (as updater.cjs keepLocalCad does).
    $oldUi = Join-Path $backup 'app/ui'
    if (Test-Path -LiteralPath $oldUi) {
        foreach ($file in Get-ChildItem -LiteralPath $oldUi -Recurse -File) {
            $rel = $file.FullName.Substring($oldUi.Length + 1)
            if ($rel -match '^vendor\\models\\' -or $rel -match '^assets\\(fields|robots)\\[^\\]+\.glb\.gz$') {
                $to = Join-Path (Join-Path $destination 'app/ui') $rel
                if (!(Test-Path -LiteralPath $to)) { New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; Copy-Item -LiteralPath $file.FullName -Destination $to }
            }
        }
    }
    Restart-App $destination
    Write-Output ('Update installed ('+$plan.version+'); restarted application')
    exit 0
}
$source = [IO.Path]::GetFullPath($plan.source)
$destination = [IO.Path]::GetFullPath($plan.destination)
$stage = [IO.Path]::GetFullPath($plan.stage).TrimEnd('\') + '\'
if (!$source.StartsWith($stage, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update source is outside staging' }
if (!(Test-Path -LiteralPath (Join-Path $destination 'app/package.json'))) { throw 'Installed app is missing' }
Wait-Process -Id $plan.pid -Timeout 60 -ErrorAction SilentlyContinue
if (Get-Process -Id $plan.pid -ErrorAction SilentlyContinue) { throw 'App did not exit; update cancelled' }
Write-Output 'App exited; replacing files'
$backup = Join-Path $stage 'previous'
New-Item -ItemType Directory -Path $backup | Out-Null
$moved = @()
$installed = @()
try {
    foreach ($item in @('app','runtime')) {
        $target = Join-Path $destination $item
        $done = $false
        for ($attempt=0; $attempt -lt 20; $attempt++) {
            try { Move-Item -LiteralPath $target -Destination $backup; $done=$true; break } catch { Start-Sleep -Milliseconds 500 }
        }
        if (!$done) { throw "Could not replace $item" }
        $moved += $item
        Move-Item -LiteralPath (Join-Path $source $item) -Destination $destination
        $installed += $item
    }
} catch {
    # The previous version goes back and is started again: a failed update must not leave Torque closed, or half replaced.
    Write-Output ('Update failed, restoring the previous version: '+$_.Exception.Message)
    try {
        foreach ($item in $installed) { Move-Item -LiteralPath (Join-Path $destination $item) -Destination (Join-Path $stage ('failed-'+$item)) }
        foreach ($item in $moved) {
            $target = Join-Path $destination $item
            # A copy that stopped part way left a piece of the new one here: it moves out of the way first.
            if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination (Join-Path $stage ('partial-'+$item)) }
            Move-Item -LiteralPath (Join-Path $backup $item) -Destination $destination
        }
    } finally {
        try { Restart-App $destination } catch { Write-Output ('Could not restart the previous version: '+$_.Exception.Message) }
    }
    throw
}
if (Test-Path -LiteralPath (Join-Path $source 'DeckDriverStation.exe')) {
    Copy-Item -LiteralPath (Join-Path $source 'DeckDriverStation.exe') -Destination $destination -Force
}
# Explorer caches shortcut icons by path, so point shortcuts at a versioned icon file.
try {
    $iconVersion=(Get-Content -LiteralPath (Join-Path $destination 'app/package.json') -Raw | ConvertFrom-Json).version
    $iconDir=Join-Path $destination 'icons'
    New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
    $icon=Join-Path $iconDir ('deck-'+$iconVersion+'.ico')
    Copy-Item -LiteralPath (Join-Path $destination 'app/ui/icon.ico') -Destination $icon -Force
    # Keep previous icon paths valid for cached, pinned and OneDrive-synced shortcuts.
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DeckIconNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); [DllImport("shell32.dll", EntryPoint="SHChangeNotify", CharSet=CharSet.Unicode)] public static extern void Path(uint e,uint f,string a,IntPtr b); }'
    $launcher=Join-Path $destination 'DeckDriverStation.exe'
    $shell=New-Object -ComObject WScript.Shell
    $folders=@([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'), (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
    foreach ($folder in $folders) {
        if (!(Test-Path -LiteralPath $folder)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $folder -Filter '*.lnk') {
            $link=$shell.CreateShortcut($file.FullName)
            if ($link.TargetPath -ieq $launcher) {
                $link.IconLocation=$icon+',0'; $link.Save()
                # Torque was Deck Driver Station: its shortcuts take the new name.
                $path=$file.FullName
                if ($file.BaseName -eq 'Deck Driver Station') {
                    $renamed=Join-Path $folder 'Torque.lnk'
                    if (Test-Path -LiteralPath $renamed) { Remove-Item -LiteralPath $path -Force } else { Rename-Item -LiteralPath $path -NewName 'Torque.lnk'; $path=$renamed }
                }
                [DeckIconNotify]::Path(0x2000,0x1005,$path,[IntPtr]::Zero)
            }
        }
    }
    [DeckIconNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
    $refresh=Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (Test-Path -LiteralPath $refresh) { Start-Process -FilePath $refresh -ArgumentList '-show' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue }
    Write-Output 'Shortcut icons refreshed'
} catch { Write-Output ('Shortcut icon refresh skipped: '+$_.Exception.Message) }
$uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation'
if ((Test-Path -LiteralPath $uninstallKey) -and (Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation -eq $destination) {
    $installedVersion=(Get-Content -LiteralPath (Join-Path $destination 'app/package.json') -Raw | ConvertFrom-Json).version
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value $installedVersion
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value 'Torque'
}
Start-Process -FilePath (Join-Path $destination 'runtime/electron.exe') -ArgumentList ('"'+(Join-Path $destination 'app')+'"') -WorkingDirectory $destination -WindowStyle Hidden
Write-Output 'Update installed; restarted application'
