@echo off
setlocal
set "TEMP=%~dp0work\tmp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
if errorlevel 1 exit /b 1
node "%~dp0src\cli.js" %*
exit /b %errorlevel%
