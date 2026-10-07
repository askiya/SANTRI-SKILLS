; SantriHub installer (Inno Setup 6).
; Build after scripts/build-santrihub.js has produced dist\SantriHub.exe:
;   ISCC.exe /DAppVersion=0.2.0 installer\santrihub.iss
; Output: dist\SantriHub-Setup.exe (per-user install, no administrator rights).

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
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=SantriHub-Setup
SetupIconFile=..\assets\santrihub.ico
UninstallDisplayIcon={app}\SantriHub.exe
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

[Files]
Source: "..\dist\SantriHub.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\SantriHub"; Filename: "{app}\SantriHub.exe"; Parameters: "app"; Comment: "Santriverse Skills untuk Google Antigravity"
Name: "{autodesktop}\SantriHub"; Filename: "{app}\SantriHub.exe"; Parameters: "app"; Tasks: desktopicon; Comment: "Santriverse Skills untuk Google Antigravity"

[Run]
Filename: "{app}\SantriHub.exe"; Parameters: "app"; Description: "{cm:LaunchProgram,SantriHub}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stop a running SantriHub so its files can be removed.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM SantriHub.exe"; Flags: runhidden; RunOnceId: "StopSantriHub"

[UninstallDelete]
; Extracted app, Edge window profile, lock and log. Installed skills and the
; Antigravity MCP config (in the user's .gemini folder) are left untouched.
Type: filesandordirs; Name: "{localappdata}\SantriHub"
