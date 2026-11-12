@echo off
rem Start both dev servers. Uses Windows Terminal tabs when available,
rem otherwise two console windows. Close a tab/window to stop that server.
rem Backend: http://127.0.0.1:8007   Frontend: http://localhost:5177
cd /d "%~dp0"

if not exist "apps\api\.venv\Scripts\python.exe" (
  echo [ERROR] apps\api\.venv not found. Run the setup steps in README first.
  pause
  exit /b 1
)

where wt >nul 2>&1
if errorlevel 1 goto fallback

wt -w 0 new-tab --title "Xingji API" cmd /k "%~dp0dev-api.cmd" ; new-tab --title "Xingji Web" cmd /k "%~dp0dev-web.cmd"
exit /b 0

:fallback
start "Xingji API" cmd /k "%~dp0dev-api.cmd"
start "Xingji Web" cmd /k "%~dp0dev-web.cmd"
echo Two windows started. Close a window to stop that server.
