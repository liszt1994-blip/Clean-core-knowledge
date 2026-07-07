@echo off
echo Building SAP Knowledge Agent desktop app...

pip install pyinstaller

pyinstaller ^
  --onedir ^
  --console ^
  --name "SAP-Knowledge-Agent" ^
  --add-data "prompts;prompts" ^
  --add-data ".env;." ^
  --add-data "C:\Users\I524685\AppData\Local\Programs\Python\Python312\Lib\site-packages\gradio;gradio" ^
  --add-data "C:\Users\I524685\AppData\Local\Programs\Python\Python312\Lib\site-packages\gradio_client;gradio_client" ^
  --add-data "C:\Users\I524685\AppData\Local\Programs\Python\Python312\Lib\site-packages\safehttpx;safehttpx" ^
  --add-data "C:\Users\I524685\AppData\Local\Programs\Python\Python312\Lib\site-packages\groovy;groovy" ^
  --hidden-import gradio ^
  --hidden-import anthropic ^
  --hidden-import dotenv ^
  main.py

echo.
echo Build complete.
echo Find the app in: dist\SAP-Knowledge-Agent\SAP-Knowledge-Agent.exe
echo Double-click that .exe to run.
pause
