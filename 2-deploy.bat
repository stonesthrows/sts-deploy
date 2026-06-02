@echo off
title STS Workflow - Deploy to Cloudflare
echo ============================================
echo  Stones Throw Studio - Deploying...
echo ============================================
echo.
cd /d "C:\Users\morph\Desktop\sts-deploy"
echo Clearing Wrangler cache...
rmdir /s /q .wrangler 2>nul
mkdir .wrangler
call npx wrangler@latest pages deploy "C:\Users\morph\Desktop\sts-deploy" --project-name=stsworkflow --branch=production --commit-dirty=true
echo.
echo ============================================
echo  Live at https://stsworkflow.pages.dev
echo ============================================
echo.
pause
