@echo off
title STS Workflow - Deploy
echo ============================================
echo  Stones Throw Studio - Deploying...
echo ============================================
echo.
cd /d "C:\Users\morph\Desktop\sts-deploy"
git add -A
git commit -m "Deploy"
git push origin main
echo.
echo ============================================
echo  Pushed! Cloudflare is building now.
echo  Live at https://stsworkflow.pages.dev
echo  Hard refresh after ~1 min: Ctrl+Shift+R
echo ============================================
echo.
pause
