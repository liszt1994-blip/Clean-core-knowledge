# SAP Knowledge Agent

A local conversational AI tool for SAP Clean Core knowledge.

## Features
- Clean Core concept explanation (Chinese & English)
- SAP object classification A/B/C/D
- Deprecated object → replacement API search
- SAP Note search

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
   SAP_S_USER=S000xxxxxxx
   SAP_S_PASSWORD=xxxxxxxx
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run (Web version):
   ```bash
   python main.py
   # Open http://localhost:7860
   ```

## Build Desktop App (.exe)

```bash
build.bat
# Run dist/SAP-Knowledge-Agent.exe
```

## Run Tests

```bash
pytest tests/ -v
```
