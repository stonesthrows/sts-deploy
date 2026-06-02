@echo off
cd /d %~dp0

set /p USERNAME="Enter your GitHub username: "

git remote add origin https://github.com/%USERNAME%/sts-deploy.git
git push -u origin main

echo.
echo === Pushed to GitHub! ===
echo Repo: https://github.com/%USERNAME%/sts-deploy
echo.
pause
