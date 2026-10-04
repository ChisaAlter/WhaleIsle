!include "LogicLib.nsh"

# Runtime dependency junctions can point at another install directory during staging.
# NSIS RMDir /r follows them, so remove each reparse point without walking its target.
!macro dshDefineRemoveDirectory Prefix
Function ${Prefix}dshRemoveDirectory
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrCpy $R4 0

  # GetFileAttributes/FindFirst/Delete must support the same long paths as Node.
  StrCpy $R3 $R0 4
  ${If} $R3 != "\\?\"
    StrCpy $R3 $R0 2
    ${If} $R3 == "\\"
      StrCpy $R0 $R0 "" 2
      StrCpy $R0 "\\?\UNC\$R0"
    ${Else}
      StrCpy $R0 "\\?\$R0"
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w r10) i.r13'
  ${If} $R3 == -1
    System::Call 'kernel32::GetLastError() i.r13'
    ${If} $R3 != 2
    ${AndIf} $R3 != 3
      StrCpy $R4 1
    ${EndIf}
    Goto dsh_remove_done
  ${EndIf}
  IntOp $R5 $R3 & 0x10
  ${If} $R5 == 0
    StrCpy $R4 1
    Goto dsh_remove_done
  ${EndIf}
  IntOp $R5 $R3 & 0x400
  ${If} $R5 != 0
    Goto dsh_remove_root
  ${EndIf}

  ClearErrors
  FindFirst $R1 $R2 "$R0\*.*"
  ${If} ${Errors}
    Goto dsh_remove_root
  ${EndIf}
  dsh_remove_next:
    ${If} $R2 == ""
      Goto dsh_remove_close
    ${EndIf}
    ${If} $R2 != "."
    ${AndIf} $R2 != ".."
      System::Call 'kernel32::GetFileAttributesW(w "$R0\$R2") i.r13'
      ${If} $R3 == -1
        StrCpy $R4 1
      ${Else}
        IntOp $R5 $R3 & 0x10
        ${If} $R5 != 0
          Push "$R0\$R2"
          Call ${Prefix}dshRemoveDirectory
          Pop $R3
          ${If} $R3 != 0
            StrCpy $R4 1
          ${EndIf}
        ${Else}
          ClearErrors
          Delete "$R0\$R2"
          ${If} ${Errors}
            StrCpy $R4 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R2
    Goto dsh_remove_next
  dsh_remove_close:
    FindClose $R1
  dsh_remove_root:
    ClearErrors
    RMDir $R0
    ${If} ${Errors}
      StrCpy $R4 1
    ${EndIf}
  dsh_remove_done:
    StrCpy $R0 $R4
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd
!macroend

!macro dshRemoveDirectory Prefix Directory
  Push $R0
  Push "${Directory}"
  Call ${Prefix}dshRemoveDirectory
  Pop $R0
  ${If} $R0 == 0
    ClearErrors
  ${Else}
    SetErrors
  ${EndIf}
  Pop $R0
!macroend
