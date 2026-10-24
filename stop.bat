@echo off
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/shutdown' -Headers @{'X-NetPulse'='1'} | Out-Null; 'NetPulse agent stopped.' } catch { 'NetPulse agent is not running.' }"
