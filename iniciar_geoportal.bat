@echo off
echo ==============================================
echo        Iniciando Servidor do Geoportal
echo ==============================================
echo.
echo O seu navegador sera aberto automaticamente.
echo Para desligar o geoportal, feche esta janela.
echo.
start http://localhost:8000
python -m http.server 8000
pause
