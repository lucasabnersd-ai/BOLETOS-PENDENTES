@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Atualizar BOLETOS-PENDENTES - S&D

set "REPO=C:\Users\lucas\OneDrive\Documents\New project 8\boletospendentes"
set "WORKBOOK=C:\Users\lucas\Grupo S&D\Gabriella Karla Oliveira Milas - FINANCEIRO COMPARTILHADO\LUCAS ABNER ARAUJO\BOLETOS PENDENTES A ASSOCIAR.xlsx"
set "RUNNER=%REPO%\ATUALIZAR_BOLETOS_PENDENTES.cmd"

echo.
echo ============================================================
echo  Atualizador do Painel de Boletos Pendentes - S^&D
echo ============================================================
echo Repo:      %REPO%
echo Planilha:  %WORKBOOK%
echo Painel:    https://lucasabnersd-ai.github.io/BOLETOS-PENDENTES/
echo.

if not exist "%RUNNER%" (
  echo ERRO: Nao encontrei o atualizador do repositorio:
  echo %RUNNER%
  pause
  exit /b 1
)

if not exist "%WORKBOOK%" (
  echo ERRO: Nao encontrei a planilha base:
  echo %WORKBOOK%
  pause
  exit /b 1
)

call "%RUNNER%"
exit /b %ERRORLEVEL%
