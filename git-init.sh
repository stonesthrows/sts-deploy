#!/bin/bash
cd "$(dirname "$0")"
rm -rf .git
git init
git branch -m main
git add .
git commit -m "Initial commit — STS workflow app"
git remote add origin https://github.com/stonesthrows/sts-deploy.git
git push -u origin main
