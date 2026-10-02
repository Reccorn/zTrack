@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title zTrack — пакет кода для ИИ

rem Версия repomix закреплена, чтобы результат не менялся от запуска к запуску.
rem Утилита запускается через npx и в проект/сборку не попадает.
set "REPOMIX=repomix@1.18.1"

echo.
echo  ==============================
echo    zTrack — пакет кода для ИИ
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js не найден.
  echo     Установите LTS-версию с https://nodejs.org и запустите pack.bat снова.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%m in ('node -v') do set NODEMAJOR=%%m
if %NODEMAJOR% LSS 22 (
  echo [!] Для repomix нужен Node.js 22 или новее, установлен v%NODEMAJOR%.
  echo     Обновите Node.js с https://nodejs.org и запустите pack.bat снова.
  echo.
  pause
  exit /b 1
)

echo [1/2] Полный пакет: Claude outputs\ztrack-pack.md
echo       (при первом запуске npx скачает repomix — это пара минут)
call npx -y %REPOMIX% --token-count-tree 1000
if errorlevel 1 goto :fail

echo.
echo [2/2] Сжатый пакет (сигнатуры и типы без тел функций): Claude outputs\ztrack-pack-compressed.md
call npx -y %REPOMIX% --compress -o "Claude outputs/ztrack-pack-compressed.md"
if errorlevel 1 goto :fail

echo.
echo  Готово! Файлы лежат в папке «Claude outputs» (в git не попадают).
echo  Перед отправкой в чат проверьте блок Security Check выше.
echo.
start "" "%~dp0Claude outputs"
pause
exit /b 0

:fail
echo.
echo [!] repomix завершился с ошибкой. Посмотрите сообщение выше.
echo.
pause
exit /b 1
