@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1
rem Build: npm run dist. Start: npm run start. Kurulum icin proje README dosyasina bakin.
call npm.cmd run start %*
exit /b %errorlevel%
