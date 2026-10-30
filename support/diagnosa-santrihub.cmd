@echo off
rem Klik dua kali file ini. Laporan diagnosa SantriHub muncul di Notepad dan tersimpan di Desktop.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnosa-santrihub.ps1"
echo.
pause
