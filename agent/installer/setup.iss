; PhantomOS Agent - Inno Setup Installer Script
; Generates a professional setup wizard (.exe)
;
; Requirements:
;   1. Inno Setup 6+ installed (https://jrsoftware.org/isinfo.php)
;   2. PhantomAgent.exe built in ../dist/
;   3. cloudflared.exe downloaded to ../dist/
;
; Build:
;   Open this file in Inno Setup Compiler and click Build > Compile
;   Or from command line: iscc setup.iss

#define AppName "PhantomOS Agent"
#define AppVersion "1.0.0"
#define AppPublisher "PhantomOS"
#define AppURL "https://phantom-bridge.onrender.com"
#define AppExeName "PhantomAgent.exe"

[Setup]
AppId={{B8F3D2A1-7E5C-4A9B-8D6F-1C2E3F4A5B6C}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\PhantomAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=PhantomAgent-Setup-{#AppVersion}
SetupIconFile=icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
LicenseFile=
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "portuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional options:"
Name: "autostart"; Description: "Start agent automatically with Windows"; GroupDescription: "Additional options:"; Flags: checkedonce
Name: "installservice"; Description: "Install as Windows Service (recommended for servers)"; GroupDescription: "Additional options:"

[Files]
Source: "..\dist\PhantomAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\cloudflared.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Configure Agent"; Filename: "{app}\{#AppExeName}"; Parameters: "--setup"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; Run setup wizard after install
Filename: "{app}\{#AppExeName}"; Parameters: "--setup"; Description: "Configure agent connection"; Flags: nowait postinstall skipifsilent runascurrentuser
; Open dashboard
Filename: "https://phantom-bridge.onrender.com/dashboard"; Description: "Open PhantomOS Dashboard"; Flags: postinstall skipifsilent shellexec unchecked

[UninstallRun]
; Stop and remove service on uninstall
Filename: "sc.exe"; Parameters: "stop PhantomAgent"; Flags: runhidden; RunOnceId: "StopService"
Filename: "sc.exe"; Parameters: "delete PhantomAgent"; Flags: runhidden; RunOnceId: "DeleteService"

[Registry]
; Autostart entry
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PhantomAgent"; ValueData: """{app}\{#AppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Code]
// Install as Windows Service if selected
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    if IsTaskSelected('installservice') then
    begin
      // Remove existing service if present
      Exec('sc.exe', 'stop PhantomAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec('sc.exe', 'delete PhantomAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(1000);
      // Create new service
      Exec('sc.exe',
        ExpandConstant('create PhantomAgent binPath= """{app}\PhantomAgent.exe""" start= auto DisplayName= "PhantomOS Agent"'),
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec('sc.exe',
        'description PhantomAgent "PhantomOS remote control agent - connects this PC to PhantomBridge"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      if ResultCode = 0 then
        MsgBox('Windows Service installed successfully! It will start automatically on boot.', mbInformation, MB_OK)
      else
        MsgBox('Service installation may have failed. You can install it manually later.', mbError, MB_OK);
    end;
  end;
end;

// Custom welcome page text
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
