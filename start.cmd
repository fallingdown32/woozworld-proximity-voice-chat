@echo off
set PORT=8795
set HOST=127.0.0.1
cd /d %~dp0
:loop
node server\index.js >> voice.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
