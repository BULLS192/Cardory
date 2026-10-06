@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js/npm was not found. Install Node.js first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for first local run...
  call npm install
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)
echo Starting local development server...
call npm run dev
pause
