from __future__ import annotations

import base64
import hmac
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


DEFAULT_CONFIG_PATH = "/etc/nexus-host-bridge/config.json"
MAX_READ_BYTES = 1024 * 1024
DEFAULT_CHUNK_SIZE = 64 * 1024


class DirectoryPolicy(BaseModel):
    root: str
    read: bool = True
    write: bool = False


class ScriptPolicy(BaseModel):
    argv: list[str] = Field(..., min_length=1)
    cwd_alias: str | None = None
    timeout_seconds: int = Field(default=60, ge=1, le=1800)
    max_output_bytes: int = Field(default=256 * 1024, ge=1024, le=5 * 1024 * 1024)


class BridgeConfig(BaseModel):
    bind_host: str = "127.0.0.1"
    bind_port: int = 8787
    shared_directories: dict[str, DirectoryPolicy] = Field(default_factory=dict)
    scripts: dict[str, ScriptPolicy] = Field(default_factory=dict)


class ScriptRequest(BaseModel):
    args: list[str] = Field(default_factory=list, description="Extra positional args appended to the allow-listed script argv.")
    env: dict[str, str] = Field(default_factory=dict, description="Extra environment variables with NEXUS_ prefix only.")


class WriteFileRequest(BaseModel):
    alias: str
    path: str
    content: str
    encoding: Literal["utf-8", "base64"] = "utf-8"


class MkdirRequest(BaseModel):
    alias: str
    path: str


class AuditEvent(BaseModel):
    at: float
    client: str
    action: str
    target: str
    ok: bool
    detail: str = ""


def load_config() -> BridgeConfig:
    config_path = Path(os.environ.get("NEXUS_HOST_BRIDGE_CONFIG", DEFAULT_CONFIG_PATH)).expanduser()
    if not config_path.exists():
        fallback = Path(__file__).with_name("host_bridge_config.example.json")
        config_path = fallback
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    return BridgeConfig.model_validate(raw)


CONFIG = load_config()
BRIDGE_TOKEN = os.environ.get("NEXUS_HOST_BRIDGE_TOKEN", "")
AUDIT_LOG = Path(os.environ.get("NEXUS_HOST_BRIDGE_AUDIT", "/var/log/nexus-host-bridge/audit.jsonl"))

app = FastAPI(
    title="Glitch Host Bridge",
    version="0.1.0",
    description="Controlled host-directory and script gateway for AI agents running inside LXC containers.",
)


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not BRIDGE_TOKEN:
        raise HTTPException(status_code=503, detail="NEXUS_HOST_BRIDGE_TOKEN is not configured.")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, BRIDGE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid bridge token.")


def audit(request: Request, action: str, target: str, ok: bool, detail: str = "") -> None:
    client = request.client.host if request.client else "unknown"
    event = AuditEvent(at=time.time(), client=client, action=action, target=target, ok=ok, detail=detail)
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json() + "\n")
    except OSError:
        pass


def directory_policy(alias: str, *, read: bool = False, write: bool = False) -> DirectoryPolicy:
    policy = CONFIG.shared_directories.get(alias)
    if not policy:
        raise HTTPException(status_code=404, detail=f"Unknown directory alias: {alias}")
    if read and not policy.read:
        raise HTTPException(status_code=403, detail=f"Directory alias is not readable: {alias}")
    if write and not policy.write:
        raise HTTPException(status_code=403, detail=f"Directory alias is not writable: {alias}")
    return policy


def resolve_alias_path(alias: str, requested: str, *, read: bool = False, write: bool = False, must_exist: bool = False) -> Path:
    policy = directory_policy(alias, read=read, write=write)
    root = Path(policy.root).expanduser().resolve()
    candidate = (root / requested).resolve(strict=False)
    try:
        common = os.path.commonpath([str(root), str(candidate)])
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Path escapes the shared directory.") from exc
    if common != str(root):
        raise HTTPException(status_code=403, detail="Path escapes the shared directory.")
    if must_exist and not candidate.exists():
        raise HTTPException(status_code=404, detail="Path does not exist.")
    return candidate


def trim_output(raw: bytes, limit: int) -> tuple[str, bool]:
    truncated = len(raw) > limit
    return raw[:limit].decode("utf-8", errors="replace"), truncated


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "directories": sorted(CONFIG.shared_directories),
        "scripts": sorted(CONFIG.scripts),
    }


@app.get("/v1/capabilities", dependencies=[Depends(require_token)])
def capabilities() -> dict[str, object]:
    return {
        "ok": True,
        "directories": {
            alias: {"read": policy.read, "write": policy.write}
            for alias, policy in CONFIG.shared_directories.items()
        },
        "scripts": {
            name: {
                "args_are_appended": True,
                "cwd_alias": policy.cwd_alias,
                "timeout_seconds": policy.timeout_seconds,
            }
            for name, policy in CONFIG.scripts.items()
        },
    }


@app.get("/v1/files/list", dependencies=[Depends(require_token)])
def list_directory(request: Request, alias: str, path: str = ".") -> dict[str, object]:
    target = resolve_alias_path(alias, path, read=True, must_exist=True)
    if not target.is_dir():
        audit(request, "files.list", f"{alias}:{path}", False, "not a directory")
        raise HTTPException(status_code=400, detail="Path is not a directory.")
    entries = []
    for entry in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        stat = entry.stat()
        entries.append({
            "name": entry.name,
            "type": "directory" if entry.is_dir() else "file",
            "size": stat.st_size if entry.is_file() else None,
            "modified_at": stat.st_mtime,
        })
    audit(request, "files.list", f"{alias}:{path}", True, f"{len(entries)} entries")
    return {"ok": True, "alias": alias, "path": path, "entries": entries}


@app.get("/v1/files/read", dependencies=[Depends(require_token)])
def read_file(
    request: Request,
    alias: str,
    path: str,
    offset: int = Query(default=0, ge=0),
    size: int = Query(default=DEFAULT_CHUNK_SIZE, ge=1, le=MAX_READ_BYTES),
    encoding: Literal["utf-8", "base64"] = "utf-8",
) -> dict[str, object]:
    target = resolve_alias_path(alias, path, read=True, must_exist=True)
    if not target.is_file():
        audit(request, "files.read", f"{alias}:{path}", False, "not a file")
        raise HTTPException(status_code=400, detail="Path is not a file.")
    with target.open("rb") as handle:
        handle.seek(offset)
        chunk = handle.read(size)
        position = handle.tell()
    data = base64.b64encode(chunk).decode("ascii") if encoding == "base64" else chunk.decode("utf-8", errors="replace")
    audit(request, "files.read", f"{alias}:{path}", True, f"{len(chunk)} bytes")
    return {
        "ok": True,
        "alias": alias,
        "path": path,
        "data": data,
        "encoding": encoding,
        "bytes_read": len(chunk),
        "position": position,
        "eof": position >= target.stat().st_size,
    }


@app.post("/v1/files/write", dependencies=[Depends(require_token)])
def write_file(request: Request, body: WriteFileRequest) -> dict[str, object]:
    target = resolve_alias_path(body.alias, body.path, write=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = base64.b64decode(body.content) if body.encoding == "base64" else body.content.encode("utf-8")
    target.write_bytes(data)
    audit(request, "files.write", f"{body.alias}:{body.path}", True, f"{len(data)} bytes")
    return {"ok": True, "alias": body.alias, "path": body.path, "bytes_written": len(data)}


@app.post("/v1/files/mkdir", dependencies=[Depends(require_token)])
def make_directory(request: Request, body: MkdirRequest) -> dict[str, object]:
    target = resolve_alias_path(body.alias, body.path, write=True)
    target.mkdir(parents=True, exist_ok=True)
    audit(request, "files.mkdir", f"{body.alias}:{body.path}", True)
    return {"ok": True, "alias": body.alias, "path": body.path}


@app.get("/v1/files/stream", dependencies=[Depends(require_token)])
def stream_file(
    request: Request,
    alias: str,
    path: str,
    chunk_size: int = Query(default=DEFAULT_CHUNK_SIZE, ge=1, le=MAX_READ_BYTES),
) -> StreamingResponse:
    target = resolve_alias_path(alias, path, read=True, must_exist=True)
    if not target.is_file():
        audit(request, "files.stream", f"{alias}:{path}", False, "not a file")
        raise HTTPException(status_code=400, detail="Path is not a file.")
    audit(request, "files.stream", f"{alias}:{path}", True)

    def iterator():
        with target.open("rb") as handle:
            while True:
                chunk = handle.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(iterator(), media_type="application/octet-stream")


@app.post("/v1/scripts/{script_name}", dependencies=[Depends(require_token)])
def run_script(request: Request, script_name: str, body: ScriptRequest) -> dict[str, object]:
    policy = CONFIG.scripts.get(script_name)
    if not policy:
        audit(request, "scripts.run", script_name, False, "unknown script")
        raise HTTPException(status_code=404, detail=f"Unknown script: {script_name}")
    if any("\x00" in arg for arg in body.args):
        raise HTTPException(status_code=400, detail="Arguments cannot contain NUL bytes.")
    cwd = None
    if policy.cwd_alias:
        cwd = str(resolve_alias_path(policy.cwd_alias, ".", read=True, must_exist=True))
    env = os.environ.copy()
    for key, value in body.env.items():
        if not key.startswith("NEXUS_"):
            raise HTTPException(status_code=400, detail="Only NEXUS_ environment variables may be passed to scripts.")
        env[key] = str(value)
    argv = [*policy.argv, *body.args]
    try:
        completed = subprocess.run(
            argv,
            cwd=cwd,
            env=env,
            shell=False,
            capture_output=True,
            timeout=policy.timeout_seconds,
            check=False,
        )
        stdout, stdout_truncated = trim_output(completed.stdout, policy.max_output_bytes)
        stderr, stderr_truncated = trim_output(completed.stderr, policy.max_output_bytes)
        audit(request, "scripts.run", script_name, completed.returncode == 0, f"exit={completed.returncode}")
        return {
            "ok": completed.returncode == 0,
            "script": script_name,
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
        }
    except subprocess.TimeoutExpired as exc:
        stdout, stdout_truncated = trim_output(exc.stdout or b"", policy.max_output_bytes)
        stderr, stderr_truncated = trim_output(exc.stderr or b"", policy.max_output_bytes)
        audit(request, "scripts.run", script_name, False, "timeout")
        return {
            "ok": False,
            "script": script_name,
            "exit_code": None,
            "stdout": stdout,
            "stderr": stderr,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
            "timed_out": True,
        }
