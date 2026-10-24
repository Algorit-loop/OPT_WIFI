@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  call "%~dp0setup.bat" || exit /b 1
)
set PYTHONNOUSERSITE=1
title NetPulse Agent - dong cua so nay de dung
".venv\Scripts\python.exe" backend\run.py %*
