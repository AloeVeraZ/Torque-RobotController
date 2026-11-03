param([string]$PlanPath)
$ErrorActionPreference = 'Stop'
Write-Output 'Starting update installer'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
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
    foreach ($item in $installed) { Move-Item -LiteralPath (Join-Path $destination $item) -Destination (Join-Path $stage ('failed-'+$item)) }
    foreach ($item in $moved) { Move-Item -LiteralPath (Join-Path $backup $item) -Destination $destination }
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
