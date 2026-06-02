@echo off
cd /d "%~dp0"
echo Current directory: %CD% > "%TEMP%\deploy-log.txt" 2>&1
echo Testing wrangler... >> "%TEMP%\deploy-log.txt" 2>&1
call npx wrangler pages deploy . --project-name=stsworkflow --commit-dirty=true >> "%TEMP%\deploy-log.txt" 2>&1
echo Done. >> "%TEMP%\deploy-log.txt" 2>&1
pause
