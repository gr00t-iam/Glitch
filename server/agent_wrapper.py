from __future__ import annotations

import base64
import asyncio
import os
import shlex
import subprocess
import threading
import time
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from server import piper_service


DEFAULT_CHUNK_SIZE = 64 * 1024
MAX_CHUNK_SIZE = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_OUTPUT_LIMIT = 512 * 1024
BUFFER_TTL_SECONDS = 15 * 60


def _configured_project_root() -> Path:
    configured = os.environ.get("NEXUS_PROJECT_ROOT") or os.environ.get("PROJECT_ROOT")
    return Path(configured).expanduser().resolve() if configured else Path.cwd().resolve()


PROJECT_ROOT = _configured_project_root()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(piper_service.ensure_piper_assets)
    yield


app = FastAPI(
    title="NexusHarness Agent Filesystem Wrapper",
    version="0.1.0",
    description=(
        "Local FastAPI sidecar that exposes a confined execute_command tool "
        "and chunked file-buffer reads for NexusHarness agents."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "NEXUS_WRAPPER_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5176,http://localhost:5176",
    ).split(","),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
app.mount("/cache", StaticFiles(directory=str(piper_service.CACHE_DIR), check_dir=False), name="cache")


class ExecuteCommandRequest(BaseModel):
    command: str | list[str] = Field(..., description="Command line string or argv list. Runs with shell=False.")
    cwd: str | None = Field(default=None, description="Working directory relative to or inside the project root.")
    timeout_seconds: int = Field(default=DEFAULT_TIMEOUT_SECONDS, ge=1, le=600)
    max_output_bytes: int = Field(default=DEFAULT_OUTPUT_LIMIT, ge=1024, le=10 * 1024 * 1024)
    env: dict[str, str] = Field(default_factory=dict, description="Extra environment variables for the child process.")


class ExecuteCommandResult(BaseModel):
    ok: bool
    tool: Literal["execute_command"] = "execute_command"
    command: list[str]
    cwd: str
    exit_code: int | None
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    timed_out: bool = False
    error: str | None = None


class OpenFileRequest(BaseModel):
    path: str = Field(..., description="File path relative to or inside the project root.")
    chunk_size: int = Field(default=DEFAULT_CHUNK_SIZE, ge=1, le=MAX_CHUNK_SIZE)


class OpenFileResult(BaseModel):
    ok: bool
    buffer_id: str
    path: str
    size: int
    position: int
    chunk_size: int
    expires_at: float


class ReadChunkResult(BaseModel):
    ok: bool
    buffer_id: str
    path: str
    data: str
    encoding: Literal["utf-8", "base64"]
    bytes_read: int
    position: int
    eof: bool


class SeekRequest(BaseModel):
    position: int = Field(..., ge=0)


class PiperTTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)


class PiperTTSResult(BaseModel):
    ok: bool
    audio_base64: str
    media_type: str = "audio/wav"
    voice: str = "en_US-amy-medium"
    output_path: str


class ChatCompletionRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)


class ChatCompletionResult(BaseModel):
    text: str
    audio_url: str
    audio_base64: str
    media_type: str = "audio/wav"


class FileBuffer:
    def __init__(self, path: Path, chunk_size: int) -> None:
        self.id = uuid4().hex
        self.path = path
        self.chunk_size = chunk_size
        self.handle = path.open("rb")
        self.created_at = time.time()
        self.last_accessed = self.created_at
        self.lock = threading.Lock()

    @property
    def expires_at(self) -> float:
        return self.last_accessed + BUFFER_TTL_SECONDS

    def touch(self) -> None:
        self.last_accessed = time.time()

    def close(self) -> None:
        self.handle.close()


buffers: dict[str, FileBuffer] = {}
buffers_lock = threading.Lock()


def resolve_inside_project(requested: str | None, *, must_exist: bool = False) -> Path:
    raw = requested or "."
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    resolved = candidate.resolve(strict=False)

    try:
        project_root = os.path.normcase(str(PROJECT_ROOT))
        resolved_path = os.path.normcase(str(resolved))
        common = os.path.commonpath([project_root, resolved_path])
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Path is outside the configured project root.") from exc

    if common != project_root:
        raise HTTPException(status_code=403, detail="Path is outside the configured project root.")
    if must_exist and not resolved.exists():
        raise HTTPException(status_code=404, detail="Path does not exist inside the configured project root.")
    return resolved


def command_to_argv(command: str | list[str]) -> list[str]:
    if isinstance(command, list):
        argv = [str(part) for part in command if str(part)]
    else:
        argv = shlex.split(command, posix=os.name != "nt")
    if not argv:
        raise HTTPException(status_code=400, detail="Command cannot be empty.")
    return argv


def trim_output(raw: bytes, limit: int) -> tuple[str, bool]:
    truncated = len(raw) > limit
    sample = raw[:limit]
    return sample.decode("utf-8", errors="replace"), truncated


def cleanup_expired_buffers() -> None:
    now = time.time()
    expired: list[FileBuffer] = []
    with buffers_lock:
        for buffer_id, file_buffer in list(buffers.items()):
            if file_buffer.expires_at < now:
                expired.append(buffers.pop(buffer_id))
    for file_buffer in expired:
        file_buffer.close()


def get_buffer(buffer_id: str) -> FileBuffer:
    cleanup_expired_buffers()
    with buffers_lock:
        file_buffer = buffers.get(buffer_id)
    if not file_buffer:
        raise HTTPException(status_code=404, detail="Unknown or expired file buffer.")
    return file_buffer


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "project_root": str(PROJECT_ROOT),
        "open_buffers": len(buffers),
        "piper_ready": (
            piper_service.PIPER_EXECUTABLE.is_file()
            and piper_service.PIPER_MODEL.is_file()
            and piper_service.PIPER_CONFIG.is_file()
        ),
    }


@app.post("/tts", response_model=PiperTTSResult)
def create_piper_audio(request: PiperTTSRequest) -> PiperTTSResult:
    audio = piper_service.generate_piper_speech(request.text.strip())
    if not audio:
        raise HTTPException(status_code=503, detail="Piper voice is unavailable right now.")
    return PiperTTSResult(
        ok=True,
        audio_base64=base64.b64encode(audio).decode("ascii"),
        output_path=str(piper_service.LATEST_WAV.resolve()),
    )


@app.post("/chat/complete", response_model=ChatCompletionResult)
def complete_chat_response(request: ChatCompletionRequest) -> ChatCompletionResult:
    text = request.text.strip()
    audio = piper_service.generate_piper_speech(text)
    if not audio or not piper_service.LATEST_WAV.is_file() or piper_service.LATEST_WAV.stat().st_size == 0:
        raise HTTPException(status_code=503, detail="Piper voice is unavailable right now.")
    return ChatCompletionResult(
        text=text,
        audio_url="/cache/latest_response.wav",
        audio_base64=base64.b64encode(audio).decode("ascii"),
    )


@app.get("/tools")
def tools() -> dict[str, object]:
    return {
        "ok": True,
        "tools": [
            {
                "name": "execute_command",
                "description": "Run a subprocess command with cwd confined to the configured project root.",
                "parameters": ExecuteCommandRequest.model_json_schema(),
            },
            {
                "name": "open_file_buffer",
                "description": "Open a project file for chunked reads without loading the whole file into memory.",
                "parameters": OpenFileRequest.model_json_schema(),
            },
        ],
    }


@app.post("/tools/execute_command", response_model=ExecuteCommandResult)
def execute_command(request: ExecuteCommandRequest) -> ExecuteCommandResult:
    cwd = resolve_inside_project(request.cwd)
    if not cwd.exists() or not cwd.is_dir():
        raise HTTPException(status_code=400, detail="cwd must be an existing directory inside the project root.")

    argv = command_to_argv(request.command)
    env = os.environ.copy()
    env.update({key: str(value) for key, value in request.env.items()})

    try:
        completed = subprocess.run(
            argv,
            cwd=str(cwd),
            env=env,
            shell=False,
            capture_output=True,
            timeout=request.timeout_seconds,
            check=False,
        )
        stdout, stdout_truncated = trim_output(completed.stdout, request.max_output_bytes)
        stderr, stderr_truncated = trim_output(completed.stderr, request.max_output_bytes)
        return ExecuteCommandResult(
            ok=completed.returncode == 0,
            command=argv,
            cwd=str(cwd),
            exit_code=completed.returncode,
            stdout=stdout,
            stderr=stderr,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
        )
    except subprocess.TimeoutExpired as exc:
        stdout, stdout_truncated = trim_output(exc.stdout or b"", request.max_output_bytes)
        stderr, stderr_truncated = trim_output(exc.stderr or b"", request.max_output_bytes)
        return ExecuteCommandResult(
            ok=False,
            command=argv,
            cwd=str(cwd),
            exit_code=None,
            stdout=stdout,
            stderr=stderr,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
            timed_out=True,
            error=f"Command timed out after {request.timeout_seconds} seconds.",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"Executable not found: {argv[0]}") from exc


@app.post("/files/open", response_model=OpenFileResult)
def open_file_buffer(request: OpenFileRequest) -> OpenFileResult:
    cleanup_expired_buffers()
    path = resolve_inside_project(request.path, must_exist=True)
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Path must be a file inside the project root.")

    file_buffer = FileBuffer(path, request.chunk_size)
    with buffers_lock:
        buffers[file_buffer.id] = file_buffer

    return OpenFileResult(
        ok=True,
        buffer_id=file_buffer.id,
        path=str(path),
        size=path.stat().st_size,
        position=0,
        chunk_size=request.chunk_size,
        expires_at=file_buffer.expires_at,
    )


@app.get("/files/{buffer_id}/read", response_model=ReadChunkResult)
def read_file_chunk(
    buffer_id: str,
    size: int | None = Query(default=None, ge=1, le=MAX_CHUNK_SIZE),
    encoding: Literal["utf-8", "base64"] = "utf-8",
) -> ReadChunkResult:
    file_buffer = get_buffer(buffer_id)
    read_size = size or file_buffer.chunk_size
    with file_buffer.lock:
        chunk = file_buffer.handle.read(read_size)
        position = file_buffer.handle.tell()
        file_buffer.touch()

    if encoding == "base64":
        data = base64.b64encode(chunk).decode("ascii")
    else:
        data = chunk.decode("utf-8", errors="replace")

    return ReadChunkResult(
        ok=True,
        buffer_id=buffer_id,
        path=str(file_buffer.path),
        data=data,
        encoding=encoding,
        bytes_read=len(chunk),
        position=position,
        eof=len(chunk) < read_size,
    )


@app.post("/files/{buffer_id}/seek")
def seek_file_buffer(buffer_id: str, request: SeekRequest) -> dict[str, object]:
    file_buffer = get_buffer(buffer_id)
    size = file_buffer.path.stat().st_size
    if request.position > size:
        raise HTTPException(status_code=400, detail="Seek position is beyond end of file.")
    with file_buffer.lock:
        file_buffer.handle.seek(request.position)
        file_buffer.touch()
    return {"ok": True, "buffer_id": buffer_id, "position": request.position}


@app.delete("/files/{buffer_id}")
def close_file_buffer(buffer_id: str) -> dict[str, object]:
    with buffers_lock:
        file_buffer = buffers.pop(buffer_id, None)
    if not file_buffer:
        raise HTTPException(status_code=404, detail="Unknown or expired file buffer.")
    file_buffer.close()
    return {"ok": True, "buffer_id": buffer_id, "closed": True}


@app.get("/files/stream")
def stream_file(
    path: str = Query(..., description="File path relative to or inside the project root."),
    chunk_size: int = Query(default=DEFAULT_CHUNK_SIZE, ge=1, le=MAX_CHUNK_SIZE),
) -> StreamingResponse:
    resolved = resolve_inside_project(path, must_exist=True)
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="Path must be a file inside the project root.")

    def iterator():
        with resolved.open("rb") as handle:
            while True:
                chunk = handle.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(iterator(), media_type="application/octet-stream", headers={"X-Nexus-Path": str(resolved)})
