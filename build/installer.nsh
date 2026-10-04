# Whale Isle NSIS customization (assisted installer only).
!include "${__FILEDIR__}\remove-directory.nsh"
!ifdef BUILD_UNINSTALLER
  !insertmacro dshDefineRemoveDirectory "un."
!else
  !insertmacro dshDefineRemoveDirectory ""
!endif
!ifndef BUILD_UNINSTALLER
  # Official stage -> close application -> rename -> register -> retire old directory.
  !include "${DSH_DIRECTORY_INSTALLER_PATH}"
!endif

# The directory installer replaces same-path upgrades atomically. For normal
# removal and relocation, never let upstream un.atomicRMDir traverse junctions.
!macro customRemoveFiles
  SetOutPath $TEMP
  !insertmacro dshRemoveDirectory "un." "$INSTDIR"
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "Cannot remove the application directory. Close running processes and retry."
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro dshFinishDirectories
!macroend

!macro customInstallerExtract Archive
  nsExec::ExecToStack '"$PLUGINSDIR\dsh-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${Archive}"'
  Pop $R0
  Pop $R1
  ${If} $R0 == 0
    # The small launcher package has no Harness payload.
    ${If} ${FileExists} "$INSTDIR\resources\runtime\install-harness.cjs"
      nsExec::ExecToStack '"$INSTDIR\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "$INSTDIR\resources\runtime\install-harness.cjs" "$INSTDIR\resources" "$dshFinalDirectory\resources"'
      Pop $R0
      Pop $R1
    ${EndIf}
  ${EndIf}
!macroend
#
# GUI polish (the three page/header macros below) is skipped in silent mode
# (/S). Directory extraction/cleanup and customInit also run during silent
# installs and upgrades. customInit performs no UI, no exec, no sections;
# it only deletes install records that are already dead (non-absolute paths
# can never resolve) and repairs a poisoned $INSTDIR.

# Inserted where assistedInstaller.nsh declares pages, i.e. before the
# license/directory/instfiles/finish pages — the only place where MUI page
# defines for the finish page can still take effect.
!macro customWelcomePage
  # electron-builder's assisted installer ships without a welcome page by
  # default; add the standard MUI one so the branded sidebar bitmap and the
  # localized (zh_CN/en_US) welcome copy are shown.
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TITLE_3LINES
  # Language-neutral link on the finish page (product home / releases).
  !define MUI_FINISHPAGE_LINK "github.com/ChisaAlter/Deepseek-Harness-Desktop"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/ChisaAlter/Deepseek-Harness-Desktop"
  !insertmacro MUI_PAGE_WELCOME
!macroend

# Inserted by assistedInstaller.nsh inside the BUILD_UNINSTALLER page list *in
# place of* the stock `!insertmacro MUI_UNPAGE_WELCOME`, so this macro must
# re-insert that page itself. MUI2's un-welcome page reuses the installer
# welcome-page settings (MUI_WELCOMEPAGE_TITLE_3LINES included) but MUI_UNSETs
# them after every page insertion, so the define from customWelcomePage never
# reaches the uninstaller — without this the localized un-welcome title's
# third line ("…Uninstall") is clipped. Page declaration only: MUI pages are
# never shown in silent mode, so /S uninstall and overwrite upgrades are
# untouched.
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customHeader
  # Replace the stock "Nullsoft Install System vX.XX" footer with the product.
  BrandingText "Whale Isle ${VERSION}"
!macroend

# --- Corrupted install-record hygiene (incident 2026-09-12) ----------------
#
# A stale record hijacks the upgrade path twice over: initMultiUser copies
# InstallLocation into $INSTDIR, and the old-uninstaller fallback derives the
# target dir from the quoted UninstallString. Both reads happen in/after
# initMultiUser; customInit runs immediately after it, still inside .onInit,
# before any page or section work.
#
# A record counts as live only when it is an absolute Win32 path AND still
# resolves on disk (InstallLocation → current or legacy app executable present;
# UninstallString → quoted uninstaller present). Anything else — drive-relative
# mangling like "C:AiDeepseek…" from an unquoted bash /D=, or a well-formed
# path whose directory was wiped — is deleted so stock upgrade logic can never
# see it, and $INSTDIR is recomputed: /D > live InstallLocation > live
# uninstaller dir > per-user default.
#
# GetInQuotes / GetFileParent are Functions from installUtil.nsh — included
# textually after .onInit, so their !macro wrappers are unavailable here, but
# Call targets resolve at compile time.
#
# _DSHD_IS_ABS src dst → dst="1" when src is an absolute Win32 path:
# X:\…, "X:\…", \\… or "\\…" (quote case covered by checking both offsets).

!macro _DSHD_IS_ABS src dst
  StrCpy ${dst} "0"
  StrCpy $1 ${src} 2
  ${If} $1 == "\\"
    StrCpy ${dst} "1"
  ${Else}
    StrCpy $1 ${src} 2 1
    ${If} $1 == ":\"
    ${OrIf} $1 == "\\"
      StrCpy ${dst} "1"
    ${Else}
      StrCpy $1 ${src} 2 2
      ${If} $1 == ":\"
        StrCpy ${dst} "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

# _DSHD_CHECK_UNINSTALL key → extracts the quoted uninstaller path, deletes the
# key when the record is dead (unquoted, non-absolute, or file missing), and
# leaves the surviving uninstaller path in $2 ($2 untouched when key empty).
!macro _DSHD_CHECK_UNINSTALL key
  ReadRegStr $1 SHELL_CONTEXT "${key}" UninstallString
  ${If} $1 != ""
    Push $1
    Call GetInQuotes
    Pop $2
    ${If} $2 == ""
      DeleteRegKey SHELL_CONTEXT "${key}"
    ${Else}
      !insertmacro _DSHD_IS_ABS $2 $R0
      ${If} $R0 == "1"
        ${IfNot} ${FileExists} "$2"
          StrCpy $R0 "0"
        ${EndIf}
      ${EndIf}
      ${If} $R0 == "0"
        DeleteRegKey SHELL_CONTEXT "${key}"
        StrCpy $2 ""
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  # Per-machine elevation comes first. The stock installer.nsi install
  # section already re-elevates for silent per-machine upgrades
  # ($hasPerMachineInstallation + ${Silent}), but that check runs after
  # .onInit — an unelevated init still reads/writes here first (the HKLM
  # record cleanup below cannot delete values under a non-admin token),
  # and an interactive upgrade of a per-machine install hits the same wall
  # later. Elevating at the top of customInit lets the elevated copy re-run
  # this whole init (admin check falls through) with full registry access.
  # Any elevation outcome quits the unelevated copy with no message —
  # customInit must stay UI-free for /S safety, and a refused UAC prompt
  # explains itself.
  ${If} $installMode == "all"
    ${IfNot} ${UAC_IsAdmin}
      ShowWindow $HWNDPARENT ${SW_HIDE}
      !insertmacro UAC_RunElevated
      Quit
    ${EndIf}
  ${EndIf}

  StrCpy $R1 "0"
  StrCpy $2 ""

  # InstallLocation: keep only a live record — absolute path that still holds
  # the current or legacy app executable. Dead entries are deleted so a wiped directory (e.g. a
  # cleaned tmp target) can never redirect a fresh install.
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    !insertmacro _DSHD_IS_ABS $0 $R0
    ${If} $R0 == "1"
      ${IfNot} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
        ${IfNot} ${FileExists} "$0\Deepseek-Harness-Desktop.exe"
          ${IfNot} ${FileExists} "$0\Deepseek-Harness-Launcher.exe"
            ${IfNot} ${FileExists} "$0\Whale Isle Launcher.exe"
              StrCpy $R0 "0"
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $R0 == "0"
      DeleteRegValue SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      StrCpy $R1 "1"
      StrCpy $0 ""
    ${EndIf}
  ${EndIf}

  # UninstallString(s): same liveness rule on the extracted uninstaller path.
  !insertmacro _DSHD_CHECK_UNINSTALL "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $2 == ""
      !insertmacro _DSHD_CHECK_UNINSTALL "${UNINSTALL_REGISTRY_KEY_2}"
    ${EndIf}
  !endif

  # Recompute $INSTDIR. Stock order preserved: an explicit /D wins, then a
  # live InstallLocation, then the live uninstaller's directory (real upgrade
  # target when InstallLocation was lost). When the record was poisoned and
  # nothing valid remains, restore the per-user default.
  !insertmacro GetDParameter $3
  ${If} $3 != ""
    StrCpy $INSTDIR $3
  ${ElseIf} $0 != ""
    StrCpy $INSTDIR $0
  ${ElseIf} $2 != ""
    Push $2
    Call GetFileParent
    Pop $4
    StrCpy $INSTDIR $4
  ${ElseIf} $R1 == "1"
    StrCpy $INSTDIR "$LocalAppData\Programs\${APP_FILENAME}"
  ${EndIf}

  # Final guard: whatever survived — including a mangled /D like
  # "C:AiDeepseek…" — must be an absolute path, else fall back to default
  # instead of landing in a drive-relative phantom directory.
  !insertmacro _DSHD_IS_ABS $INSTDIR $R0
  ${If} $R0 == "0"
    StrCpy $INSTDIR "$LocalAppData\Programs\${APP_FILENAME}"
  ${EndIf}
!macroend
