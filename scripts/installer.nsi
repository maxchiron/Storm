; Storm — Windows installer
;
; Built with NSIS directly rather than through electron-builder, because
; electron-builder's NSIS target runs the freshly generated uninstaller under
; `wine` to materialise it — a step that only works on Windows or with wine
; installed. makensis produces a complete installer (and its own native
; uninstaller) on any platform.
;
; Everything below is passed in with /D at compile time.

Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef APP_NAME
  !define APP_NAME "Storm"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "1.0.0"
!endif
!ifndef APP_EXE
  !define APP_EXE "Storm.exe"
!endif
!ifndef APP_DESCRIPTION
  !define APP_DESCRIPTION "Storm 游戏库"
!endif
!ifndef APP_PUBLISHER
  !define APP_PUBLISHER "Storm"
!endif

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallLocation"

; Per-user install: no UAC prompt, no admin rights needed.
RequestExecutionLevel user
; The payload is already an LZMA-compressed 7-Zip archive, so the installer
; stub itself is compressed lightly — that keeps the build fast.
SetCompressor zlib

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_DESCRIPTION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "${APP_PUBLISHER}"
VIAddVersionKey /LANG=2052 "CompanyName" "${APP_PUBLISHER}"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_NAME}"
!define MUI_FINISHPAGE_RUN_CHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Function .onInit
  SetShellVarContext current
  ; A running copy of Storm holds its own files open, and they cannot be
  ; replaced while it does. Warn before touching anything — the install
  ; section double-checks and refuses if the application is still running.
  IfFileExists "$INSTDIR\${APP_EXE}" 0 done
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${APP_NAME} 似乎正在运行。$\n$\n请先关闭 ${APP_NAME} 再继续安装，否则正在使用的文件无法被替换。$\n$\n要继续吗？" /SD IDOK IDOK done
    Abort
  done:
FunctionEnd

Section "安装" SEC_INSTALL
  SetOutPath "$INSTDIR"

  ; A running executable cannot be deleted, so this doubles as an "is Storm
  ; still running?" probe. Removing the old copy here is harmless — the
  ; payload below contains a fresh one. Without this check the extraction
  ; would silently skip the locked files and leave a half-updated program
  ; behind, which still looks like the old version after a "successful"
  ; install.
  Delete "$INSTDIR\${APP_EXE}"
  IfFileExists "$INSTDIR\${APP_EXE}" app_running app_not_running
  app_running:
    MessageBox MB_OK|MB_ICONEXCLAMATION "${APP_NAME} 正在运行，无法更新程序文件。$\n$\n请先关闭 ${APP_NAME}（包括系统托盘中的图标），然后重新运行安装程序。"
    Abort
  app_not_running:

  File "${APP_7Z}"

  ; Unpack the application payload. The plugin's return value is not trusted —
  ; the extracted files are checked instead.
  DetailPrint "正在解压程序文件，请稍候…"
  nsis7z::Extract "$INSTDIR\app.7z" "$INSTDIR"
  Pop $0
  Delete "$INSTDIR\app.7z"

  IfFileExists "$INSTDIR\${APP_EXE}" 0 extract_failed
    Goto extract_ok
  extract_failed:
    MessageBox MB_OK|MB_ICONSTOP "安装失败：无法解压程序文件（$0）。$\n$\n请重新下载安装包后再试。"
    Abort
  extract_ok:

  ; The payload carries a marker whose name embeds the version it was built
  ; from. It proves that the files on disk came from this installer and not
  ; from an older one. (The version rides in the filename so the check needs
  ; no string comparison, which is fragile in a Unicode NSIS build.)
  IfFileExists "$INSTDIR\Storm.${APP_VERSION}.version" version_ok version_missing
  version_missing:
    MessageBox MB_OK|MB_ICONSTOP "安装失败：安装包不完整或与本次安装的版本不一致。$\n$\n请重新下载安装程序后再试。"
    Abort
  version_ok:
    Delete "$INSTDIR\Storm.${APP_VERSION}.version"

  SetOutPath "$INSTDIR"
  File "${APP_ICON}"
  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  ; Shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_ICON}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall ${APP_NAME}.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_ICON}" 0

  ; Remember the install location for the next update
  WriteRegStr HKCU "Software\${APP_NAME}" "InstallLocation" "$INSTDIR"

  ; Programs and Features entry
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ; The library itself lives in %APPDATA%\storm and is deliberately left alone
  ; when the app is removed.
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\Uninstall ${APP_NAME}.exe"
  Delete "$INSTDIR\${APP_ICON}"
  RMDir /r "$INSTDIR"

  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
SectionEnd
