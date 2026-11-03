Unicode true
!include "MUI2.nsh"
Name "Torque"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\DeckDriverStation"
RequestExecutionLevel user
SetCompressor /FINAL zlib
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Torque Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "Torque Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
; Modern UI sets Setup's icon itself (its stock disk unless told): the round app mark, and the sidebar with it.
!define MUI_ICON "${SETUP_ICON}"
!define MUI_UNICON "${SETUP_ICON}"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBAR}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${SIDEBAR}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\DeckDriverStation.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Torque"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Torque"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "${PAYLOAD}\DeckDriverStation.exe"
  SetOutPath "$INSTDIR\app"
  File /r "${PAYLOAD}\app\*"
  SetOutPath "$INSTDIR\runtime"
  File /r "${PAYLOAD}\runtime\*"
  ; Versioned icon path: Explorer caches shortcut icons by path, so updates show the new one.
  ; Keep previous icon paths valid for cached and OneDrive-synced shortcuts.
  SetOutPath "$INSTDIR\icons"
  File "/oname=deck-${VERSION}.ico" "${ICON}"
  SetOutPath "$INSTDIR"
  ; Torque was Deck Driver Station: its shortcuts are replaced by Torque's.
  Delete "$DESKTOP\Deck Driver Station.lnk"
  Delete "$SMPROGRAMS\Deck Driver Station.lnk"
  CreateShortCut "$DESKTOP\Torque.lnk" "$INSTDIR\DeckDriverStation.exe" "" "$INSTDIR\icons\deck-${VERSION}.ico" 0
  CreateShortCut "$SMPROGRAMS\Torque.lnk" "$INSTDIR\DeckDriverStation.exe" "" "$INSTDIR\icons\deck-${VERSION}.ico" 0
  System::Call 'shell32::SHChangeNotify(i 0x2000,i 0x1005,t "$DESKTOP\Torque.lnk",p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x2000,i 0x1005,t "$SMPROGRAMS\Torque.lnk",p 0)'
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  FileOpen $0 "$INSTDIR\.deck-driver-station-install" w
  FileWrite $0 "dev.deckdriverstation.app"
  FileClose $0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "DisplayName" "Torque"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "DisplayIcon" "$INSTDIR\DeckDriverStation.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation" "NoRepair" 1
  System::Call 'shell32::SHChangeNotify(i 0x08000000,i 0,p 0,p 0)'
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  GetFullPathName $INSTDIR "$INSTDIR"
  FileOpen $0 "$INSTDIR\.deck-driver-station-install" r
  IfErrors unsafe
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "dev.deckdriverstation.app" owned unsafe
  unsafe:
    MessageBox MB_ICONSTOP "The installation marker is missing. No app folders were removed."
    Abort
  owned:
  Delete "$DESKTOP\Torque.lnk"
  Delete "$SMPROGRAMS\Torque.lnk"
  Delete "$DESKTOP\Deck Driver Station.lnk"
  Delete "$SMPROGRAMS\Deck Driver Station.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeckDriverStation"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\icons"
  Delete "$INSTDIR\DeckDriverStation.exe"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\.deck-driver-station-install"
  RMDir "$INSTDIR"
SectionEnd
