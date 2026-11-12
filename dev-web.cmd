@echo off
rem Frontend only. Runs in the current window; Ctrl+C to stop.
title Xingji Web
cd /d "%~dp0apps\web"
pnpm dev
