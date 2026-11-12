@echo off
rem Backend only. Runs in the current window; Ctrl+C to stop.
title Xingji API
cd /d "%~dp0"
"apps\api\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir apps\api --reload --port 8007
