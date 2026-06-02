@echo off
cd /d %~dp0

echo === Setting up git repo for STS Workflow ===

:: Write .gitignore
(
echo node_modules/
echo .env
echo *.env
echo gmail-brief.json
echo scanned-orders.json
echo processed-drive-scans.json
echo cf-screenshot.png
echo *.log
echo .netlify
) > .gitignore

git init
git branch -m main
git add .
git commit -m "Initial commit — STS workflow app"

echo.
echo === Done! Local git repo created. ===
echo.
echo Next: go to https://github.com/new and create a new repo called sts-deploy
echo Then run 4-git-remote.bat with your GitHub username.
echo.
pause
