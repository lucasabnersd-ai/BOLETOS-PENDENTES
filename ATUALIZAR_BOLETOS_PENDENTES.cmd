@echo off
setlocal
title Atualizar Painel de Boletos Pendentes

set "REPO=C:\Users\lucas\OneDrive\Documents\New project 8\boletospendentes"
set "PYTHON=C:\Users\lucas\AppData\Local\Programs\Python\Python312\python.exe"
set "GIT=C:\Program Files\Git\cmd\git.exe"
set "WORKBOOK=C:\Users\lucas\Grupo S&D\Gabriella Karla Oliveira Milas - FINANCEIRO COMPARTILHADO\LUCAS ABNER ARAUJO\BOLETOS PENDENTES A ASSOCIAR.xlsx"
set "CRUZAMENTO=C:\Users\lucas\Grupo S&D\Gabriella Karla Oliveira Milas - FINANCEIRO COMPARTILHADO\LUCAS ABNER ARAUJO\AUTOMAÇÕES LUCAS\RODAR_ASSOCIADOR_BOLETOS\cruzamento_data.js"

cd /d "%REPO%"
echo.
echo ============================================================
echo  Atualizando Painel de Boletos Pendentes - S^&D
echo ============================================================
echo Planilha: %WORKBOOK%
echo.

"%PYTHON%" "%REPO%\scripts\sync_excel_to_supabase.py" --workbook "%WORKBOOK%" --repo "%REPO%" --delete-missing --force-large-delete
if errorlevel 1 (
  echo.
  echo Falha ao sincronizar. Confira a mensagem acima.
  pause
  exit /b 1
)

if exist "%CRUZAMENTO%" (
  "%PYTHON%" "%REPO%\scripts\sync_cruzamento_to_supabase.py" --source "%CRUZAMENTO%"
  if errorlevel 1 (
    echo.
    echo Falha ao sincronizar o cruzamento de NFes.
    pause
    exit /b 1
  )
)

"%GIT%" add index.html styles.css app.js scripts\sync_excel_to_supabase.py ATUALIZAR_BOLETOS_PENDENTES.cmd README.md assets\. .nojekyll .gitignore tests\.
"%GIT%" diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo Nenhuma alteracao nova para publicar no GitHub.
  pause
  exit /b 0
)

"%GIT%" commit -m "Atualiza painel de boletos pendentes"
if errorlevel 1 (
  echo.
  echo Falha ao criar commit.
  pause
  exit /b 1
)

"%GIT%" push origin HEAD:main
if errorlevel 1 (
  echo.
  echo Falha ao enviar para o GitHub.
  pause
  exit /b 1
)

echo.
echo Atualizacao concluida e publicada.
echo URL: https://lucasabnersd-ai.github.io/BOLETOS-PENDENTES/
pause
