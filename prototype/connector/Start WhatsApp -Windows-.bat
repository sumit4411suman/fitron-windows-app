@echo off
title Fitron WhatsApp connector
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page - install the LTS version, then double-click this file again.
  start https://nodejs.org/en/download
  pause
  exit /b
)
if not exist node_modules (
  echo First run: installing, this takes 2-3 minutes...
  call npm install --omit=dev
)
echo.
echo Starting. Now open Fitron ^> Settings ^> WhatsApp ^> Link WhatsApp and scan the QR.
echo Keep this window open. Closing it stops WhatsApp messages.
echo.
node server.js
pause
