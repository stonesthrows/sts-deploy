@echo off
title STS Workflow - Cloudflare First-Time Setup
echo ============================================
echo  One-Time Cloudflare Setup
echo ============================================
echo.
echo Step 1: Logging in to Cloudflare...
echo (A browser window will open — log in and click Allow)
echo.
cd /d "%~dp0"
call npx wrangler login
echo.
echo Step 2: Creating your Cloudflare Pages project...
call npx wrangler pages project create stsworkflow
echo.
echo ============================================
echo  Setup complete! Run 2-deploy.bat to go live.
echo  Your site will be at: https://stsworkflow.pages.dev
echo ============================================
echo.
pause
