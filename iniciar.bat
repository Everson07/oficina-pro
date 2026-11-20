@echo off
title Oficina Pro - Gestao Tecnica & Patio
echo ====================================================
echo   🚗 OFICINA PRO - GESTAO TECNICA E PATIO
echo ====================================================
echo   Iniciando o servidor local...
echo   Banco de Dados: oficina.db (SQLite Nativo)
echo   Acesse no navegador: http://localhost:3000
echo ====================================================

start http://localhost:3000
node server.js
pause
