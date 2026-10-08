; Ogmios's own installer pages.
;
; installer.nsi is Tauri's NSIS template with its list of pages replaced by
; the OG_* macros below; what gets installed, and how an update runs, is
; still Tauri's. This file reaches the template as its "installer hooks",
; which puts it ahead of the template's own definitions: everything here is
; therefore a macro, expanded where the template inserts it.
;
; A page is one dark window: the wizard's header, its line and its Back,
; Next and Cancel buttons are moved out of sight, and the page area is
; stretched over the whole window. Next is still the default button, so
; Enter moves on.
;
; ASCII only: every sentence the learner reads is in lang/*.nsh.

!include nsDialogs.nsh
!include LogicLib.nsh
!include WinMessages.nsh

!define OG_DIR "${__FILEDIR__}"

; The page, in pixels at 100 % scale.
!define OG_WIDTH 460
!define OG_HEIGHT 330
!define OG_LOGO 72

; The dark and the gold are the icon's own (scripts/installer-assets.ps1
; prints them), so the logo's square disappears into the page; the rest is
; the dark theme of src/styles/global.css, in the hexadecimal NSIS wants.
!define OG_BG 16181D
!define OG_RAISED 23252D
!define OG_INK EEEFF3
!define OG_SOFT A9ACB8
!define OG_GOLD E9C46A
!define OG_ON_GOLD 2C2410
; The same gold and raised grey as Windows writes a colour: blue first.
!define OG_GOLD_BGR 0x006AC4E9
!define OG_RAISED_BGR 0x002D2523
!define OG_INK_BGR 0x00F3EFEE
!define OG_BG_BGR 0x001D1816

Var OgDpi
Var OgW
Var OgH
Var OgLogoSide
Var OgLogoImage
Var OgFontTitle
Var OgFontBody
Var OgFontButton
Var OgFontLink
Var OgDialog
Var OgTitle
Var OgSub
Var OgBar
Var OgButton
Var OgOptions
Var OgOptionsOpen
Var OgTagline
Var OgDirText
Var OgBrowse
Var OgDesktopBox
Var OgDesktopLabel
Var OgDesktop
Var OgRun

; Scales a rectangle given at 100 % to the window's scale: left $R8, top $R7,
; width $R5, height $R6. X is a number, or "center".
!macro OG_RECT X Y W H
  IntOp $R5 ${W} * $OgDpi
  IntOp $R5 $R5 / 96
  IntOp $R6 ${H} * $OgDpi
  IntOp $R6 $R6 / 96
  IntOp $R7 ${Y} * $OgDpi
  IntOp $R7 $R7 / 96
  !if "${X}" == "center"
    IntOp $R8 $OgW - $R5
    IntOp $R8 $R8 / 2
  !else
    IntOp $R8 ${X} * $OgDpi
    IntOp $R8 $R8 / 96
  !endif
!macroend

; A line of text on a page made with nsDialogs. Leaves its handle in $R9.
!macro OG_LABEL X Y W H STYLE FONT COLOUR TEXT
  !insertmacro OG_RECT "${X}" ${Y} ${W} ${H}
  nsDialogs::CreateControl STATIC "${DEFAULT_STYLES}|${STYLE}" 0 $R8 $R7 $R5 $R6 "${TEXT}"
  Pop $R9
  SendMessage $R9 ${WM_SETFONT} ${FONT} 1
  SetCtlColors $R9 0x${OG_COLOUR_${COLOUR}} 0x${OG_BG}
!macroend
!define OG_COLOUR_INK ${OG_INK}
!define OG_COLOUR_SOFT ${OG_SOFT}
!define OG_COLOUR_GOLD ${OG_GOLD}

; The logo on a page made with nsDialogs.
!macro OG_LOGO_AT Y
  !insertmacro OG_RECT 0 ${Y} 0 0
  IntOp $R8 $OgW - $OgLogoSide
  IntOp $R8 $R8 / 2
  nsDialogs::CreateControl STATIC "${DEFAULT_STYLES}|${SS_BITMAP}" 0 $R8 $R7 $OgLogoSide $OgLogoSide ""
  Pop $R9
  SendMessage $R9 ${STM_SETIMAGE} ${IMAGE_BITMAP} $OgLogoImage
!macroend

; The one gold button of a page: a label, so that it takes the page's colours
; and its text is a translated string like any other, with rounded corners.
!macro OG_BUTTON Y TEXT ONCLICK
  !insertmacro OG_RECT center ${Y} 200 42
  nsDialogs::CreateControl STATIC "${DEFAULT_STYLES}|${SS_CENTER}|${SS_CENTERIMAGE}|${SS_NOTIFY}" 0 $R8 $R7 $R5 $R6 "${TEXT}"
  Pop $OgButton
  SendMessage $OgButton ${WM_SETFONT} $OgFontButton 1
  SetCtlColors $OgButton 0x${OG_ON_GOLD} 0x${OG_GOLD}
  IntOp $R9 14 * $OgDpi
  IntOp $R9 $R9 / 96
  IntOp $R5 $R5 + 1
  IntOp $R6 $R6 + 1
  System::Call "gdi32::CreateRoundRectRgn(i 0, i 0, i R5, i R6, i R9, i R9) p .R9"
  System::Call "user32::SetWindowRgn(p $OgButton, p R9, i 1)"
  ${NSD_OnClick} $OgButton ${ONCLICK}
!macroend

; A check box and its sentence, centred as one line. The box is drawn by
; Windows' dark theme, which cannot colour a caption: the sentence is a label
; of its own, and a click on it ticks the box. Leaves the box in $R9.
!macro OG_CHECK Y TEXT ONCLICK
  StrLen $R5 "${TEXT}"
  System::Call "user32::GetDC(p $OgDialog) p .R6"
  System::Call "gdi32::SelectObject(p R6, p $OgFontBody) p .R7"
  System::Call "*(i, i) p .R8"
  System::Call 'gdi32::GetTextExtentPoint32(p R6, w "${TEXT}", i R5, p R8)'
  System::Call "*$R8(i .R4, i)"
  System::Free $R8
  System::Call "gdi32::SelectObject(p R6, p R7)"
  System::Call "user32::ReleaseDC(p $OgDialog, p R6)"
  ; $R4 is the sentence's width; the box and the gap before it are 24 more.
  !insertmacro OG_RECT 0 ${Y} 24 22
  IntOp $R4 $R4 + 4
  IntOp $R8 $OgW - $R4
  IntOp $R8 $R8 - $R5
  IntOp $R8 $R8 / 2
  IntOp $R3 $R8 + $R5
  IntOp $R5 $R5 * 3
  IntOp $R5 $R5 / 4
  nsDialogs::CreateControl BUTTON "${DEFAULT_STYLES}|${WS_TABSTOP}|${BS_AUTOCHECKBOX}" 0 $R8 $R7 $R5 $R6 ""
  Pop $R9
  System::Call 'uxtheme::SetWindowTheme(p $R9, w "DarkMode_Explorer", p 0)'
  SetCtlColors $R9 0x${OG_INK} 0x${OG_BG}
  nsDialogs::CreateControl STATIC "${DEFAULT_STYLES}|${SS_CENTERIMAGE}|${SS_NOTIFY}" 0 $R3 $R7 $R4 $R6 "${TEXT}"
  Pop $R4
  SendMessage $R4 ${WM_SETFONT} $OgFontBody 1
  SetCtlColors $R4 0x${OG_INK} 0x${OG_BG}
  ${NSD_OnClick} $R4 ${ONCLICK}
!macroend

; A control on a page NSIS made itself, where nsDialogs is not there to
; create it. Leaves its handle in $R9.
!macro OG_RAW X Y W H STYLE FONT COLOUR TEXT
  !insertmacro OG_RECT "${X}" ${Y} ${W} ${H}
  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "${TEXT}", i ${DEFAULT_STYLES}|${STYLE}, i R8, i R7, i R5, i R6, p $OgDialog, p 0, p 0, p 0) p .R9'
  SendMessage $R9 ${WM_SETFONT} ${FONT} 1
  SetCtlColors $R9 0x${OG_COLOUR_${COLOUR}} 0x${OG_BG}
!macroend

; What the installer and the uninstaller both need. UN is "" or "un.".
!macro OG_SHARED UN
  Function ${UN}ogGuiInit
    System::Call "user32::GetDpiForWindow(p $HWNDPARENT) i .s"
    Pop $OgDpi
    ${If} $OgDpi < 96
      StrCpy $OgDpi 96
    ${EndIf}
    IntOp $OgW ${OG_WIDTH} * $OgDpi
    IntOp $OgW $OgW / 96
    IntOp $OgH ${OG_HEIGHT} * $OgDpi
    IntOp $OgH $OgH / 96

    ; The title bar in the page's colour, whatever accent Windows is set to
    ; (Windows 11; Windows 10 gets its plain dark title bar), and the page's
    ; colour behind everything.
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)"
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i ${OG_BG_BGR}, i 4)"
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${OG_BG_BGR}, i 4)"
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i ${OG_INK_BGR}, i 4)"
    SetCtlColors $HWNDPARENT "" 0x${OG_BG}

    ; The window takes the size of the page, in the middle of the screen.
    System::Call "*(i, i, i, i) p .r0"
    System::Call "user32::GetWindowRect(p $HWNDPARENT, p r0)"
    System::Call "*$0(i .r1, i .r2, i .r3, i .r4)"
    IntOp $3 $3 - $1
    IntOp $4 $4 - $2
    System::Call "user32::GetClientRect(p $HWNDPARENT, p r0)"
    System::Call "*$0(i, i, i .r5, i .r6)"
    System::Free $0
    IntOp $3 $3 - $5
    IntOp $3 $3 + $OgW
    IntOp $4 $4 - $6
    IntOp $4 $4 + $OgH
    System::Call "user32::GetSystemMetrics(i 0) i .r5"
    System::Call "user32::GetSystemMetrics(i 1) i .r6"
    IntOp $5 $5 - $3
    IntOp $5 $5 / 2
    IntOp $6 $6 - $4
    IntOp $6 $6 / 2
    System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i r5, i r6, i r3, i r4, i 0x14)"

    ; Everything the wizard draws around a page goes out of sight. NSIS shows
    ; and hides its buttons again on every page, so they are moved, not hidden.
    System::Call "user32::GetWindow(p $HWNDPARENT, i 5) p .r0"
    ${DoWhile} $0 P<> 0
      System::Call "user32::SetWindowPos(p r0, p 0, i -9000, i -9000, i 0, i 0, i 0x15)"
      System::Call "user32::GetWindow(p r0, i 2) p .r0"
    ${Loop}

    ; The page area, which every page is laid over, is the whole window.
    GetDlgItem $0 $HWNDPARENT 1018
    System::Call "user32::SetWindowPos(p r0, p 0, i 0, i 0, i $OgW, i $OgH, i 0x14)"

    CreateFont $OgFontTitle "Segoe UI" 18 600
    CreateFont $OgFontBody "Segoe UI" 10 400
    CreateFont $OgFontButton "Segoe UI" 11 600
    CreateFont $OgFontLink "Segoe UI" 9 400 /UNDERLINE

    ; The logo drawn for this scale, or for the nearest one below it.
    InitPluginsDir
    IntOp $0 $OgDpi * 100
    IntOp $0 $0 / 96
    ${If} $0 >= 200
      File "/oname=$PLUGINSDIR\og-logo.bmp" "${OG_DIR}\logo-200.bmp"
      StrCpy $OgLogoSide 200
    ${ElseIf} $0 >= 175
      File "/oname=$PLUGINSDIR\og-logo.bmp" "${OG_DIR}\logo-175.bmp"
      StrCpy $OgLogoSide 175
    ${ElseIf} $0 >= 150
      File "/oname=$PLUGINSDIR\og-logo.bmp" "${OG_DIR}\logo-150.bmp"
      StrCpy $OgLogoSide 150
    ${ElseIf} $0 >= 125
      File "/oname=$PLUGINSDIR\og-logo.bmp" "${OG_DIR}\logo-125.bmp"
      StrCpy $OgLogoSide 125
    ${Else}
      File "/oname=$PLUGINSDIR\og-logo.bmp" "${OG_DIR}\logo-100.bmp"
      StrCpy $OgLogoSide 100
    ${EndIf}
    IntOp $OgLogoSide $OgLogoSide * ${OG_LOGO}
    IntOp $OgLogoSide $OgLogoSide / 100
    System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\og-logo.bmp", i ${IMAGE_BITMAP}, i 0, i 0, i ${LR_LOADFROMFILE}) p .s'
    Pop $OgLogoImage
  FunctionEnd

  ; The gold button does what Next did.
  Function ${UN}ogNext
    Pop $0
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  ; The progress page is NSIS's own: its log and its status line are hidden,
  ; its bar is recoloured, and the logo and a title are added to it.
  Function ${UN}ogProgressShow
    FindWindow $OgDialog "#32770" "" $HWNDPARENT
    SetCtlColors $OgDialog "" 0x${OG_BG}
    ; NSIS gives its own pages the size of their template, not of the page area.
    System::Call "user32::SetWindowPos(p $OgDialog, p 0, i 0, i 0, i $OgW, i $OgH, i 0x14)"
    GetDlgItem $0 $OgDialog 1006
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $OgDialog 1016
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $OgDialog 1027
    ShowWindow $0 ${SW_HIDE}

    !insertmacro OG_RECT 0 60 0 0
    IntOp $R8 $OgW - $OgLogoSide
    IntOp $R8 $R8 / 2
    System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "", i ${DEFAULT_STYLES}|${SS_BITMAP}, i R8, i R7, i $OgLogoSide, i $OgLogoSide, p $OgDialog, p 0, p 0, p 0) p .R9'
    SendMessage $R9 ${STM_SETIMAGE} ${IMAGE_BITMAP} $OgLogoImage

    !if "${UN}" == ""
      ${If} $UpdateMode = 1
        !insertmacro OG_RAW 0 144 ${OG_WIDTH} 30 ${SS_CENTER} $OgFontButton INK "$(ogUpdating)"
      ${Else}
        !insertmacro OG_RAW 0 144 ${OG_WIDTH} 30 ${SS_CENTER} $OgFontButton INK "$(ogInstalling)"
      ${EndIf}
    !else
      !insertmacro OG_RAW 0 144 ${OG_WIDTH} 30 ${SS_CENTER} $OgFontButton INK "$(ogUninstalling)"
    !endif
    StrCpy $OgTitle $R9
    !insertmacro OG_RAW 0 204 ${OG_WIDTH} 24 ${SS_CENTER} $OgFontBody SOFT "$(ogWait)"
    StrCpy $OgSub $R9

    ; A themed bar ignores its colours: this one is plain, flat and gold.
    GetDlgItem $OgBar $OgDialog 1004
    System::Call 'uxtheme::SetWindowTheme(p $OgBar, w " ", w " ")'
    System::Call "user32::SetWindowLong(p $OgBar, i -20, i 0)"
    System::Call "user32::GetWindowLong(p $OgBar, i -16) i .r0"
    IntOp $0 $0 & 0xFF7FFFFF
    System::Call "user32::SetWindowLong(p $OgBar, i -16, i r0)"
    SendMessage $OgBar 0x0409 0 ${OG_GOLD_BGR}
    SendMessage $OgBar 0x2001 0 ${OG_RAISED_BGR}
    !insertmacro OG_RECT center 186 280 6
    System::Call "user32::SetWindowPos(p $OgBar, p 0, i R8, i R7, i R5, i R6, i 0x34)"

    ; With nothing left to read on it, the page moves on by itself.
    SetAutoClose true
  FunctionEnd

  ; NSIS leaves a failed installation on this page: it says so, over the log.
  Function ${UN}ogProgressLeave
    IfAbort 0 done
      !if "${UN}" == ""
        SendMessage $OgTitle ${WM_SETTEXT} 0 "STR:$(ogFailed)"
      !else
        SendMessage $OgTitle ${WM_SETTEXT} 0 "STR:$(ogUninstallFailed)"
      !endif
      ShowWindow $OgSub ${SW_HIDE}
      ShowWindow $OgBar ${SW_HIDE}
      GetDlgItem $0 $OgDialog 1016
      System::Call 'uxtheme::SetWindowTheme(p r0, w "DarkMode_Explorer", p 0)'
      System::Call "user32::SetWindowLong(p r0, i -20, i 0)"
      SendMessage $0 0x1001 0 ${OG_RAISED_BGR}
      SendMessage $0 0x1026 0 ${OG_RAISED_BGR}
      SendMessage $0 0x1024 0 ${OG_INK_BGR}
      !insertmacro OG_RECT 30 186 400 120
      System::Call "user32::SetWindowPos(p r0, p 0, i R8, i R7, i R5, i R6, i 0x34)"
      ShowWindow $0 ${SW_SHOW}
      ; Its last line is the reason.
      SendMessage $0 0x1004 0 0 $1
      IntOp $1 $1 - 1
      SendMessage $0 0x1013 $1 0
    done:
  FunctionEnd
!macroend

; Before the pages: the window itself.
!macro OG_DEFINES
  ; The title bar says the app's name, not "Ogmios Setup".
  Caption "${PRODUCTNAME}"
  UninstallCaption "${PRODUCTNAME}"
  !define MUI_CUSTOMFUNCTION_GUIINIT ogGuiInit
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.ogGuiInit
  !insertmacro OG_SHARED ""
  !insertmacro OG_SHARED "un."
!macroend

; 1. Start: one button, and behind "Options" the folder and the desktop
;    shortcut. The button names what it will do to the version installed.
!macro OG_PAGE_START
  Page custom ogStart ogStartLeave

  Function ogStart
    ${If} $PassiveMode = 1
      Abort
    ${EndIf}

    StrCpy $1 "$(ogInstall)"
    ReadRegStr $0 SHCTX "${UNINSTKEY}" "DisplayVersion"
    ${If} $0 != ""
      nsis_tauri_utils::SemverCompare "${VERSION}" $0
      Pop $0
      ${If} $0 = 1
        StrCpy $1 "$(ogUpdate)"
      ${Else}
        StrCpy $1 "$(ogReinstall)"
      ${EndIf}
    ${EndIf}

    nsDialogs::Create 1018
    Pop $OgDialog
    ${If} $OgDialog == error
      Abort
    ${EndIf}
    SetCtlColors $OgDialog "" 0x${OG_BG}

    !insertmacro OG_LOGO_AT 26
    !insertmacro OG_LABEL 0 104 ${OG_WIDTH} 38 ${SS_CENTER} $OgFontTitle INK "${PRODUCTNAME}"
    !insertmacro OG_LABEL 0 146 ${OG_WIDTH} 24 ${SS_CENTER} $OgFontBody SOFT "$(ogTagline)"
    StrCpy $OgTagline $R9

    ; The options take the place of the sentence.
    !insertmacro OG_RECT 40 148 286 26
    nsDialogs::CreateControl EDIT "${DEFAULT_STYLES}|${WS_TABSTOP}|${ES_AUTOHSCROLL}" 0 $R8 $R7 $R5 $R6 "$INSTDIR"
    Pop $OgDirText
    SendMessage $OgDirText ${WM_SETFONT} $OgFontBody 1
    SetCtlColors $OgDirText 0x${OG_INK} 0x${OG_RAISED}
    IntOp $R9 8 * $OgDpi
    IntOp $R9 $R9 / 96
    IntOp $R5 $R9 << 16
    IntOp $R5 $R5 | $R9
    SendMessage $OgDirText ${EM_SETMARGINS} 3 $R5
    !insertmacro OG_RECT 332 147 88 28
    nsDialogs::CreateControl BUTTON "${DEFAULT_STYLES}|${WS_TABSTOP}" 0 $R8 $R7 $R5 $R6 "$(ogBrowse)"
    Pop $OgBrowse
    SendMessage $OgBrowse ${WM_SETFONT} $OgFontBody 1
    System::Call 'uxtheme::SetWindowTheme(p $OgBrowse, w "DarkMode_Explorer", p 0)'
    ${NSD_OnClick} $OgBrowse ogBrowse
    !insertmacro OG_CHECK 186 "$(createDesktop)" ogDesktopToggle
    StrCpy $OgDesktopBox $R9
    StrCpy $OgDesktopLabel $R4
    ${If} $OgDesktop != 0
      ${NSD_Check} $OgDesktopBox
    ${EndIf}

    !insertmacro OG_BUTTON 226 "$1" ogNext
    !insertmacro OG_LABEL center 284 160 20 ${SS_CENTER}|${SS_NOTIFY} $OgFontLink SOFT "$(ogOptions)"
    StrCpy $OgOptions $R9
    ${NSD_OnClick} $OgOptions ogOptionsToggle

    Call ogOptionsShow
    nsDialogs::Show
  FunctionEnd

  Function ogOptionsShow
    ${If} $OgOptionsOpen = 1
      StrCpy $0 ${SW_SHOW}
      StrCpy $1 ${SW_HIDE}
    ${Else}
      StrCpy $0 ${SW_HIDE}
      StrCpy $1 ${SW_SHOW}
    ${EndIf}
    ShowWindow $OgTagline $1
    ShowWindow $OgDirText $0
    ShowWindow $OgBrowse $0
    ShowWindow $OgDesktopBox $0
    ShowWindow $OgDesktopLabel $0
  FunctionEnd

  Function ogOptionsToggle
    Pop $0
    IntOp $OgOptionsOpen 1 - $OgOptionsOpen
    Call ogOptionsShow
  FunctionEnd

  Function ogDesktopToggle
    Pop $0
    ${NSD_GetState} $OgDesktopBox $0
    ${If} $0 = ${BST_CHECKED}
      ${NSD_Uncheck} $OgDesktopBox
    ${Else}
      ${NSD_Check} $OgDesktopBox
    ${EndIf}
  FunctionEnd

  ; A folder picked by hand gets the app's own folder inside it, as NSIS's
  ; directory page does.
  Function ogBrowse
    Pop $0
    ${NSD_GetText} $OgDirText $0
    nsDialogs::SelectFolderDialog "$(ogBrowseTitle)" "$0"
    Pop $0
    ${If} $0 != error
      StrLen $1 "\${PRODUCTNAME}"
      StrCpy $2 $0 "" -$1
      ${If} $2 != "\${PRODUCTNAME}"
        StrCpy $2 $0 "" -1
        ${If} $2 == "\"
          StrCpy $0 "$0${PRODUCTNAME}"
        ${Else}
          StrCpy $0 "$0\${PRODUCTNAME}"
        ${EndIf}
      ${EndIf}
      ${NSD_SetText} $OgDirText $0
    ${EndIf}
  FunctionEnd

  Function ogStartLeave
    ${NSD_GetText} $OgDirText $0
    ${If} $0 == ""
      StrCpy $OgOptionsOpen 1
      Call ogOptionsShow
      Abort
    ${EndIf}
    StrCpy $INSTDIR $0
    ${NSD_GetState} $OgDesktopBox $OgDesktop
  FunctionEnd
!macroend

; 2. Progress.
!macro OG_PAGE_INSTFILES
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ogProgressShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ogProgressLeave
  !insertmacro MUI_PAGE_INSTFILES
!macroend

; 3. Done: the desktop shortcut the start page asked for, and a button that
;    opens the app. Closing the window opens nothing.
!macro OG_PAGE_DONE
  Page custom ogDone ogDoneLeave

  Function ogDone
    ${If} $PassiveMode = 1
      Abort
    ${EndIf}
    ${If} $OgDesktop = ${BST_CHECKED}
      Call CreateOrUpdateDesktopShortcut
    ${EndIf}

    nsDialogs::Create 1018
    Pop $OgDialog
    ${If} $OgDialog == error
      Abort
    ${EndIf}
    SetCtlColors $OgDialog "" 0x${OG_BG}

    !insertmacro OG_LOGO_AT 40
    !insertmacro OG_LABEL 0 120 ${OG_WIDTH} 38 ${SS_CENTER} $OgFontTitle INK "$(ogDone)"
    !insertmacro OG_LABEL 0 162 ${OG_WIDTH} 24 ${SS_CENTER} $OgFontBody SOFT "$(ogDoneLong)"
    !insertmacro OG_BUTTON 226 "$(ogOpen)" ogOpen

    ; NSIS locks the window's close button once the files are in; here it is
    ; the way to finish without opening the app.
    GetDlgItem $0 $HWNDPARENT 2
    EnableWindow $0 1
    System::Call "user32::GetSystemMenu(p $HWNDPARENT, i 0) p .r0"
    System::Call "user32::EnableMenuItem(p r0, i 0xF060, i 0)"
    System::Call "user32::DrawMenuBar(p $HWNDPARENT)"
    nsDialogs::Show
  FunctionEnd

  Function ogOpen
    Pop $0
    StrCpy $OgRun 1
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  Function ogDoneLeave
    ${If} $OgRun = 1
      Call RunMainBinary
    ${EndIf}
  FunctionEnd
!macroend

; Uninstaller, 1. Confirm, with the choice of deleting what was learned.
!macro OG_UNPAGE_CONFIRM
  UninstPage custom un.ogConfirm un.ogConfirmLeave

  Function un.ogConfirm
    ${If} $PassiveMode = 1
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $OgDialog
    ${If} $OgDialog == error
      Abort
    ${EndIf}
    SetCtlColors $OgDialog "" 0x${OG_BG}

    !insertmacro OG_LOGO_AT 26
    !insertmacro OG_LABEL 0 104 ${OG_WIDTH} 38 ${SS_CENTER} $OgFontTitle INK "$(ogUninstallTitle)"

    !insertmacro OG_LABEL 0 146 ${OG_WIDTH} 24 ${SS_CENTER} $OgFontBody SOFT "$(ogUninstallLong)"
    !insertmacro OG_CHECK 184 "$(deleteAppData)" un.ogDeleteToggle
    StrCpy $DeleteAppDataCheckbox $R9

    !insertmacro OG_BUTTON 226 "$(ogUninstall)" un.ogNext
    nsDialogs::Show
  FunctionEnd

  Function un.ogDeleteToggle
    Pop $0
    ${NSD_GetState} $DeleteAppDataCheckbox $0
    ${If} $0 = ${BST_CHECKED}
      ${NSD_Uncheck} $DeleteAppDataCheckbox
    ${Else}
      ${NSD_Check} $DeleteAppDataCheckbox
    ${EndIf}
  FunctionEnd

  Function un.ogConfirmLeave
    ${NSD_GetState} $DeleteAppDataCheckbox $DeleteAppDataCheckboxState
  FunctionEnd
!macroend

; Uninstaller, 2. Progress.
!macro OG_UNPAGE_INSTFILES
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ogProgressShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ogProgressLeave
  !insertmacro MUI_UNPAGE_INSTFILES
!macroend
