# NexusHarness FastAPI Agent Wrapper

This sidecar gives an agent direct filesystem access without copy-pasting large file contents into prompts.

## Run

```powershell
cd "C:\Users\jrmym\Documents\Ultimate PWA Harness"
python -m venv .venv
.\.venv\Scripts\pip install -r server\requirements.txt
$env:NEXUS_PROJECT_ROOT = (Get-Location).Path
.\.venv\Scripts\uvicorn server.agent_wrapper:app --host 127.0.0.1 --port 8765
```

`NEXUS_PROJECT_ROOT` confines command working directories and file reads. If omitted, the wrapper uses the directory where `uvicorn` was started.

## Agent Tool

`POST /tools/execute_command`

```json
{
  "command": "npm run build",
  "cwd": ".",
  "timeout_seconds": 60
}
```

Commands run through Python `subprocess.run(..., shell=False)` and the `cwd` must resolve inside `NEXUS_PROJECT_ROOT`.

## Chunked File Reads

Open a file:

```json
POST /files/open
{
  "path": "src/App.tsx",
  "chunk_size": 65536
}
```

Read the next chunk:

```text
GET /files/{buffer_id}/read?encoding=utf-8
```

Use `encoding=base64` for binary-safe reads. Close buffers with `DELETE /files/{buffer_id}`. Buffers also expire after 15 minutes of inactivity.

For raw HTTP streaming, use:

```text
GET /files/stream?path=src/App.tsx&chunk_size=65536
```

## Neural Network Module

`server/nexus_nn.py` provides the configurable `NexusNN` PyTorch module, a
JSON-serializable structure inspector, and a deterministic mock training loop.

```powershell
python -m server.nexus_nn
python -m unittest server.test_nexus_nn
```

## Offline Piper Voice

On first startup, the Python sidecar downloads Piper and Amy from the official Rhasspy sources into:

```text
.nexus_bin\piper\piper.exe
.nexus_bin\piper\en_US-amy-medium.onnx
.nexus_bin\piper\en_US-amy-medium.onnx.json
```

`POST /tts` accepts `{ "text": "..." }`, atomically writes `cache\latest_response.wav`, and returns both the absolute path and base64 audio.
