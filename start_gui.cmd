@echo off
setlocal
cd /d "%~dp0"
title VideoMemo
set "PYTHONUTF8=1"
set "PYTHON_EXE=python"
if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
"%PYTHON_EXE%" src\app_gui.py %*
if errorlevel 1 (
  echo.
  echo Failed to start. Install deps: "%PYTHON_EXE%" -m pip install -r requirements.txt
  pause
)
