@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title zTrack — сборка

echo.
echo  ==============================
echo    zTrack — сборка .exe
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js не найден.
  echo     Установите LTS-версию с https://nodejs.org и запустите build.bat снова.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo  Node.js %NODEVER%
echo.

echo [1/2] Установка зависимостей (только при первом запуске занимает пару минут)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [2/2] Сборка установщика и portable-версии...
call npm run build:win
if errorlevel 1 goto :fail

echo.
echo  Готово! Файлы лежат в папке dist:
echo    zTrack-Setup-*.exe    — установщик (рекомендуется)
echo    zTrack-Portable-*.exe — версия без установки
echo.
start "" "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo [!] Сборка завершилась с ошибкой. Посмотрите сообщение выше
echo     и раздел «Если что-то пошло не так» в README.md.
echo.
pause
exit /b 1
