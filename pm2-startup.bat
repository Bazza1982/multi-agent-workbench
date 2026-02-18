@echo off
:: PM2 Startup Script for Windows
:: Run this at system startup to restore PM2 processes

cd /d "%~dp0"
pm2 resurrect
