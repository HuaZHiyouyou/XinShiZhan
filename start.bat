@echo off
setlocal enabledelayedexpansion
title 心事站 · 一键启动
cd /d "%~dp0"

echo ================================================
echo              心事站 · 一键启动
echo    让每一份情绪都被及时回应
echo ================================================
echo.

rem ── 0. 参数：加上 build 可强制重新构建前端 ──────────────────
set "FORCE_BUILD="
if /i "%~1"=="build" set "FORCE_BUILD=1"
if /i "%~1"=="--build" set "FORCE_BUILD=1"

rem ── 1. 检查 Node.js ─────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 goto :no_node
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo [√] 已检测到 Node.js !NODEVER!

where npm >nul 2>nul
if errorlevel 1 goto :no_node
echo [√] 已检测到 npm
echo.

rem ── 2. 安装依赖（缺什么装什么，第二次启动会直接跳过）────────
if not exist "node_modules" (
  echo [*] 首次运行：安装根目录依赖，可能需要几分钟…
  call npm install
  if errorlevel 1 goto :install_fail
)
if not exist "server\node_modules" (
  echo [*] 首次运行：安装服务端依赖…
  call npm --prefix server install
  if errorlevel 1 goto :install_fail
)
if not exist "web\node_modules" (
  echo [*] 首次运行：安装前端依赖…
  call npm --prefix web install
  if errorlevel 1 goto :install_fail
)
echo [√] 依赖已就绪

rem ── 3. 构建前端产物（dist 缺失或显式要求时构建）─────────────
if defined FORCE_BUILD goto :do_build
if not exist "web\dist\index.html" goto :do_build
goto :built

:do_build
echo [*] 正在构建前端页面，请稍候…
call npm --prefix web run build
if errorlevel 1 goto :build_fail
echo [√] 前端构建完成
goto :built

:built
echo.

rem ── 4. 起服务并打开浏览器 ───────────────────────────────────
if not defined PORT set "PORT=8787"
set "SITE_URL=http://localhost:!PORT!"

echo [√] 服务地址：!SITE_URL!
echo [√] 超级管理员：huazhiyou
echo.
echo     关闭本窗口即停止服务（或按 Ctrl+C）。
echo     需要重新构建前端时，运行：start.bat build
echo ================================================
echo.

rem 让浏览器等服务 3 秒再打开，避免页面比服务先到
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start !SITE_URL!"

rem ── 5. 切到 UTF-8 代码页启动服务端，让服务端日志正常显示 ──────
rem     这一段（chcp 前后）刻意只放纯 ASCII，避免代码页切换时解析错行
set "OLDCP="
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLDCP=%%c"
set "OLDCP=!OLDCP:.=!"
set "OLDCP=!OLDCP: =!"
if not "!OLDCP!"=="" chcp 65001 >nul

call npm --prefix server start
set "EXITCODE=%ERRORLEVEL%"

if not "!OLDCP!"=="" chcp !OLDCP! >nul
echo.

rem ── 6. 收尾提示 ─────────────────────────────────────────────
if not "%EXITCODE%"=="0" (
  echo [×] 服务已退出（代码 %EXITCODE%）。
  echo     常见原因：端口 !PORT! 被占用、或数据库文件被其它程序锁定。
  echo     换个端口可以这样启动：set PORT=8899 ^&^& start.bat
) else (
  echo [√] 服务已正常停止。
)
echo.
pause
exit /b %EXITCODE%

rem ── 错误分支 ────────────────────────────────────────────────
:no_node
echo [×] 没有检测到 Node.js。
echo.
echo     请先安装 Node.js 22 或更高版本：https://nodejs.org/
echo     安装时保持默认选项即可，装完重新双击本文件。
echo.
pause
exit /b 1

:install_fail
echo.
echo [×] 依赖安装失败，请检查网络连接后重试。
echo     如果使用了代理，可以先设置镜像源：
echo       npm config set registry https://registry.npmmirror.com
echo.
pause
exit /b 1

:build_fail
echo.
echo [×] 前端构建失败，请把上面的报错信息反馈给维护者。
echo.
pause
exit /b 1
