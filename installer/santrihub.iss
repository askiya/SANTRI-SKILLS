; SantriHub installer (Inno Setup 6.3+).
; Build after scripts/build-santrihub.js has staged dist\SantriHub\:
;   ISCC.exe /DAppVersion=0.3.0 installer\santrihub.iss
; Output: dist\SantriHub-Setup.exe (per-user install, no administrator rights).
;
; Installed layout ({app} = %LOCALAPPDATA%\Programs\SantriHub):
;   runtime\node.exe   official Node.js for this CPU (x64 or ARM64), signature intact
;   app\               SantriHub (JavaScript) + santrihub-install.json
; The shortcuts run node.exe with app\bin\cli.js. No unsigned program is installed.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; Never change AppId: Windows uses it to recognise upgrades and the uninstaller.
AppId={{552379FB-5AEC-4663-8618-354F26FDF266}
AppName=SantriHub
AppVersion={#AppVersion}
AppVerName=SantriHub {#AppVersion}
AppPublisher=Santriverse
AppPublisherURL=https://santriverse.my.id
AppSupportURL=https://santriverse.my.id
AppUpdatesURL=https://github.com/askiya/SANTRI-SKILLS/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName=SantriHub
VersionInfoDescription=SantriHub Setup
DefaultDirName={localappdata}\Programs\SantriHub
DefaultGroupName=SantriHub
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
; x64 PCs, and ARM PCs natively (Windows 10 ARM cannot run x64 programs).
ArchitecturesAllowed=x64compatible or arm64
ArchitecturesInstallIn64BitMode=x64compatible or arm64
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=SantriHub-Setup
SetupIconFile=..\assets\santrihub.ico
UninstallDisplayIcon={app}\santrihub.ico
UninstallDisplayName=SantriHub
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile=..\LICENSE

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; SantriHub.exe of versions up to 0.2.5 (unsigned single executable) and the previous
; app files, so files removed in this version do not linger.
Type: files; Name: "{app}\SantriHub.exe"
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "..\dist\SantriHub\runtime\win-x64\node.exe"; DestDir: "{app}\runtime"; Check: not IsArm64; Flags: ignoreversion
Source: "..\dist\SantriHub\runtime\win-arm64\node.exe"; DestDir: "{app}\runtime"; Check: IsArm64; Flags: ignoreversion
Source: "..\dist\SantriHub\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\dist\SantriHub\santrihub.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Minimized: node.exe briefly owns a console before SantriHub relaunches without one.
Name: "{autoprograms}\SantriHub"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\bin\cli.js"" app"; WorkingDir: "{app}"; IconFilename: "{app}\santrihub.ico"; Flags: runminimized; Comment: "SantriHub - skills dan MCP untuk AI agent"
Name: "{autodesktop}\SantriHub"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\bin\cli.js"" app"; WorkingDir: "{app}"; IconFilename: "{app}\santrihub.ico"; Flags: runminimized; Tasks: desktopicon; Comment: "SantriHub - skills dan MCP untuk AI agent"

[Run]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\bin\cli.js"" app"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,SantriHub}"; Flags: nowait postinstall skipifsilent runminimized

[UninstallRun]
; Stop SantriHub and its MCP server (only node.exe of this install, never other Node.js programs).
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -WindowStyle Hidden -Command ""Get-Process node -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -like '*\SantriHub\runtime\node.exe' } | Stop-Process -Force"""; Flags: runhidden; RunOnceId: "StopSantriHub"
; Up to 0.2.5
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM SantriHub.exe"; Flags: runhidden; RunOnceId: "StopSantriHubExe"

[UninstallDelete]
; App window profile, lock and log. Installed skills and the MCP configs of the
; AI agents (e.g. the user's .gemini folder) are left untouched.
Type: filesandordirs; Name: "{localappdata}\SantriHub"
