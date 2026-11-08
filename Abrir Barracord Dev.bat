@echo off
setlocal
cd /d "%~dp0" || exit /b 1

set "BARRACORD_ROLE=host"
set "BARRACORD_USE_DIST="

call npm.cmd run desktop:dev
set "barracordExitCode=%errorlevel%"
if not "%barracordExitCode%"=="0" pause
exit /b %barracordExitCode%
