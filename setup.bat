@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem Moi thu cai vao thu muc nay: .venv (thu vien Python), khong dung pip cache ngoai
set PIP_NO_CACHE_DIR=1
set PIP_DISABLE_PIP_VERSION_CHECK=1
set PYTHONNOUSERSITE=1

if exist ".venv\Scripts\python.exe" goto :install

rem Tim Python 3.10+: thu "py -3" truoc, roi "python". Phai chay thu that, vi "python"
rem co the chi la alias Microsoft Store trong khi may chua cai Python.
set "PY="
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul && set "PY=python"
if not defined PY goto :nopython

echo [NetPulse] Tao moi truong Python trong .venv ...
%PY% -m venv .venv || goto :err

:install
echo [NetPulse] Cai thu vien vao .venv ...
".venv\Scripts\python.exe" -m pip install -q -r backend\requirements.txt || goto :err
echo [NetPulse] Cai dat xong.
exit /b 0

:nopython
echo [NetPulse] Khong tim thay Python 3.10 tro len.
echo   Cai Python tu https://www.python.org/downloads/ (tick "Add python.exe to PATH"), roi chay lai.
echo   Neu da cai ma van bao loi: Settings ^> Apps ^> Advanced app settings ^> App execution aliases,
echo   tat "python.exe" / "python3.exe" (alias Microsoft Store).
pause
exit /b 1

:err
echo [NetPulse] Cai dat that bai.
pause
exit /b 1
