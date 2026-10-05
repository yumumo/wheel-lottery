@echo off
REM 幸运转盘一键推送脚本
REM 用法：双击运行，或命令行 push.bat "提交说明"
chcp 65001 >nul
cd /d "%~dp0"

set MSG=%~1
if "%MSG%"=="" set MSG=update

git add -A
git commit -m "%MSG%" 2>nul
if errorlevel 1 (
  echo.
  echo [提示] 没有可提交的改动，或提交失败。
)
git push
echo.
echo 完成：%MSG%
pause