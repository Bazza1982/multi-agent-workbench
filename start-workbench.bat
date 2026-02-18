@echo off
cd /d "%~dp0"
echo Starting Multi-Agent Workbench...

:: 启动后端服务器（新窗口，最小化）
start /min "Workbench-Backend" cmd /c "node server/index.js"

:: 等待后端启动
timeout /t 3 /nobreak >nul

:: 启动前端（新窗口，最小化）
start /min "Workbench-Frontend" cmd /c "npx vite"

:: 等待前端启动
timeout /t 5 /nobreak >nul

:: 打开浏览器
start http://localhost:5173/

echo Workbench started!
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
