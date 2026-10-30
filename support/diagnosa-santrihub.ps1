# Diagnosa SantriHub: kenapa SantriHub tidak bisa dipasang atau dibuka di laptop ini.
# Hanya MEMBACA informasi sistem lalu menulis laporan ke Desktop. Tidak mengubah apa pun.
# Nama user Windows diganti <user> di laporan. Jalankan lewat diagnosa-santrihub.cmd.
$ErrorActionPreference = 'SilentlyContinue'
$lines = New-Object System.Collections.Generic.List[string]
function Add([string]$text) { $lines.Add($text) }
function Section([string]$title) { Add ''; Add "=== $title ===" }

Add "Diagnosa SantriHub - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

Section 'Windows'
$os = Get-CimInstance Win32_OperatingSystem
Add "Versi        : $($os.Caption) $($os.Version) (build $($os.BuildNumber))"
Add "Arsitektur   : OS $($os.OSArchitecture), CPU $env:PROCESSOR_ARCHITECTURE"
if ([int]$os.BuildNumber -lt 10240) { Add 'MASALAH      : Windows lebih lama dari Windows 10. SantriHub butuh Windows 10/11.' }
if (-not [Environment]::Is64BitOperatingSystem) { Add 'MASALAH      : Windows 32-bit. SantriHub hanya untuk Windows 64-bit.' }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -and [int]$os.BuildNumber -lt 22000) { Add 'MASALAH      : Windows 10 ARM tidak bisa menjalankan aplikasi x64. Perlu Windows 11.' }
$drive = Get-PSDrive ($env:LOCALAPPDATA.Substring(0, 1))
Add ("Disk kosong  : {0:N1} GB di drive {1}:" -f ($drive.Free / 1GB), $drive.Name)
if ($drive.Free -lt 500MB) { Add 'MASALAH      : Ruang disk kurang dari 500 MB.' }

Section 'Keamanan Windows'
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
$sacText = @{ 0 = 'Mati'; 1 = 'AKTIF'; 2 = 'Evaluasi' }[[int]$sac]
if ($null -eq $sac) { $sacText = 'Tidak ada (Windows 10 atau versi lama)' }
Add "Smart App Control : $sacText"
if ($sac -eq 1) { Add 'MASALAH           : Smart App Control AKTIF memblokir aplikasi yang belum ditandatangani (seperti SantriHub saat ini).' }
$ss = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer').SmartScreenEnabled
Add "SmartScreen       : $(if ($ss) { $ss } else { 'default' })"
Add "PowerShell mode   : $($ExecutionContext.SessionState.LanguageMode)"
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Add 'MASALAH           : PowerShell dibatasi (AppLocker/WDAC). Biasanya laptop kantor/sekolah.' }
$applocker = @((Get-AppLockerPolicy -Effective).RuleCollections | ForEach-Object { $_ }).Count
Add "Aturan AppLocker  : $applocker"
$av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct
Add "Antivirus         : $(($av | ForEach-Object { $_.displayName }) -join ', ')"
$threats = @(Get-MpThreatDetection | Where-Object { ($_.Resources -join ' ') -match 'santri' })
if ($threats.Count) {
  Add "MASALAH           : Windows Defender pernah memblokir file SantriHub ($($threats.Count)x):"
  $threats | ForEach-Object { Add "  $($_.InitialDetectionTime)  ThreatID $($_.ThreatID)  $($_.Resources -join '; ')" }
} else { Add 'Defender          : tidak ada deteksi SantriHub' }

Section 'Browser untuk jendela SantriHub'
$found = $false
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe")
foreach ($c in $candidates) { if (Test-Path $c) { Add "Ada   : $c"; $found = $true } }
if (-not $found) { Add 'Tidak ada Edge/Chrome/Brave. SantriHub 0.2.5 ke bawah butuh Microsoft Edge.' }

Section 'SantriHub'
$exe = "$env:LOCALAPPDATA\Programs\SantriHub\SantriHub.exe"
if (Test-Path $exe) {
  Add "Terpasang   : $exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)"
  Add "Versi file  : $((Get-Item $exe).VersionInfo.ProductVersion)"
  Add "Tanda tangan: $((Get-AuthenticodeSignature $exe).Status)"
} else { Add "Belum terpasang di $exe" }
$setup = Get-ChildItem "$env:USERPROFILE\Downloads\SantriHub-Setup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($setup) {
  Add "Installer   : $($setup.FullName) ($([math]::Round($setup.Length / 1MB)) MB)"
  if (Get-Content $setup.FullName -Stream Zone.Identifier) { Add 'Installer ditandai "dari internet" (memicu SmartScreen).' }
}
$data = "$env:LOCALAPPDATA\SantriHub"
Add "Folder data : $(if (Test-Path $data) { (Get-ChildItem $data -Name) -join ', ' } else { 'belum ada' })"
$log = "$data\santrihub.log"
if (Test-Path $log) { Add '--- 40 baris terakhir santrihub.log ---'; Get-Content $log -Tail 40 | ForEach-Object { Add $_ } }

$text = ($lines -join "`r`n").Replace($env:USERNAME, '<user>')
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'diagnosa-santrihub.txt'
[IO.File]::WriteAllText($out, $text, (New-Object Text.UTF8Encoding $true))
Write-Host $text
Write-Host ''
Write-Host "Laporan disimpan di: $out"
Write-Host 'Kirim file itu ke admin Santriverse.'
Start-Process notepad.exe $out
