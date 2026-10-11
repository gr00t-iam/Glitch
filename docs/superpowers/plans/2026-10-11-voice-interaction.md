# Offline Voice Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add live offline dictation, opt-in Hey Glitch activation and local spoken completion reports without automatic task submission.

**Architecture:** A dedicated audio coordinator owns microphone/playback arbitration. Vosk recognizes audio captured through sounddevice; a Windows SAPI COM thread speaks sanitized completion reports. Native bridge snapshots carry recording-generation and conversation IDs so asynchronous results cannot contaminate another draft.

**Tech Stack:** Python 3.12, Vosk 0.3.45, sounddevice 0.5.6, comtypes 1.4.17, Windows SAPI, PyWebView, PyInstaller.

**Spec:** `docs/superpowers/specs/2026-10-11-voice-interaction-design.md`. Completion subscription integration uses `docs/superpowers/plans/2026-10-11-shared-model-subagents.md`, Task 3; dictation and manual speech can be implemented independently first.

## Global Constraints

- No cloud speech, automatic Send, stored microphone recordings, agent-triggered capture or Discord-triggered capture.
- Listen for Hey Glitch and Speak when a task finishes default off; persist explicit user choices.
- Default microphone, offline English recognizer; 120-second ceiling, 20,000-character draft limit, bounded audio queue.
- Wake phrase exact `hey glitch`, initial word confidence >=0.85, two-second post-speech silence, ten-second no-speech timeout, three-second cooldown.
- Speech reports are parent-completion-only, deduplicated, sanitized literal text <=600 characters; volume 0-100 and rate -10 to 10.
- Capture and playback never overlap. Re-arm only opted-in wake listening, never interrupted dictation.
- Keep the user's running executable/model untouched; package to a new versioned directory.

## Review Focus

1. Late partial/final results after chat switch or Cancel: never alter the new/original draft (Tasks 2, 5).
2. Microphone denial, unplugging or queue overflow: bounded memory, capture released, readable error (Task 2).
3. Television/background speech: no substring activation, strict phrase/confidence/cooldown checks (Task 3).
4. Completion replay or sensitive output: no duplicate announcements or raw secrets/logs/files (Task 4).
5. Audio feedback and mute races: no self-dictation, no unintended re-arm after disable (Tasks 3-4).

## File Map

- New `glitch/voice_models.py`: speech model download/verification and safe archive extraction.
- New `glitch/voice.py`: offline speech input and bounded capture lifecycle.
- New `glitch/audio.py`: wake/dictation/playback state and ownership.
- New `glitch/speech_output.py`: SAPI thread and sanitized completion announcements.
- Modify `glitch/storage.py`, `api.py`, `main.py`, `glitch/ui/{index.html,app.js,style.css}`, requirements and packaging.

### Task 1: Speech Model Setup

**Files:** New `glitch/voice_models.py`, `glitch/tests/test_voice_models.py`; modify requirements files and `glitch/Glitch.spec`.

**Interfaces:** `VoiceModelManager.start_download() -> None`; `cancel() -> None`; `status() -> dict`; `model_path() -> Path | None`; `close() -> None`.

- [ ] Write tests for successful verified extraction, corrupted zip, parent/absolute/link paths, cancelled transfer, extraction size limit, and interrupted install retaining no ready state.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_voice_models -v`; confirm failures.
- [ ] Implement asynchronous setup from the official Vosk small-English URL, bound archive/extracted sizes and atomically publish ready models. Fetch once during implementation to establish and record a reviewed checksum; distinguish observed checksum from publisher attestation. Do not invent a hash or trust changing downloads on every launch.
- [ ] Pin Vosk 0.3.45, sounddevice 0.5.6 and comtypes 1.4.17 with resolved dependency locks; include Vosk/PortAudio DLLs and license notices in the frozen package.
- [ ] Run tests and a packaged import/DLL-loading check; commit manager, dependencies, packaging and tests.

### Task 2: Streaming Dictation

**Files:** New `glitch/voice.py`, `glitch/audio.py`, `glitch/tests/test_voice_input.py`.

**Interfaces:** `SpeechInputService.start(conversation_id: str) -> str` returns generation ID; `stop(generation_id: str) -> None`; `cancel(generation_id: str) -> None`; `status() -> dict`; `close() -> None`. Snapshot includes phase, conversation_id, generation_id, interim, finalized utterance IDs/text, error. `AudioCoordinator` owns exclusive capture/playback transitions and publishes the combined snapshot.

- [ ] Write tests for partial -> final -> Stop with no duplicate words, original typed draft preservation, Cancel, old-generation rejection, device failure, queue overflow and maximum duration/text limits. Inject a recognizer/audio source/clock so tests never record the user's microphone.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_voice_input -v`; confirm failures.
- [ ] Implement sounddevice RawInputStream and Vosk recognition on a worker, using actual input sample rate, bounded PCM queue and deterministic stream teardown. Keep interim separate from committed utterances; no task submission callback exists in this service.
- [ ] Run tests and offline fixture recognition; ensure GUI calls return promptly and microphone resources are released in finally.
- [ ] Commit input/audio coordinator and tests.

### Task 3: Hey Glitch Activation

**Files:** Modify `glitch/voice.py`, `glitch/audio.py`, `glitch/storage.py`; new `glitch/tests/test_wake_word.py`, licensed positive/negative fixture files under `glitch/tests/fixtures/voice/`.

**Interfaces:** `AudioCoordinator.set_wake_enabled(enabled: bool) -> None`; `mute() -> None`; `status() -> dict`; wake activation invokes SpeechInputService.start only after an active conversation is prepared by a supplied callback. Settings adds `wake_word_enabled: bool = False`.

- [ ] Write tests for exact finalized wake phrase with sufficient confidence, ordinary words/substrings rejected, low confidence rejected, phrase removed from transcript, cooldown, silence timeouts, mute during callbacks, device change and shutdown. Add a speaker-playback fixture which must never be captured while playback owns audio.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_wake_word -v`; confirm failures.
- [ ] Implement constrained Vosk wake recognition (`hey glitch` and unknown rejection), local-only rolling buffer, explicit opt-in capture, phase transitions and timeouts from the spec. Finalize to draft, not Send. Re-arm only while consent remains enabled; recover device changes visibly and fail closed on permission denial.
- [ ] Run fixture tests; record false positives/negatives and calibrate confidence before release. Test the actual phrase in quiet/noisy conditions with user-enabled microphone separately; do not claim fixture success proves Siri-level accuracy.
- [ ] Commit wake behavior, settings, licensed fixtures and tests.

### Task 4: Local Speech Output And Completion Routing

**Files:** New `glitch/speech_output.py`, `glitch/tests/test_speech_output.py`; modify `glitch/audio.py`, `glitch/storage.py`.

**Interfaces:** `SpeechOutputService.voices() -> list[dict]`; `speak(text: str, voice_id: str | None, volume: int, rate: int) -> None`; `stop() -> None`; `status() -> dict`; `close() -> None`. `CompletionAnnouncements.on_completed(event: dict) -> None` consumes coordinator completion subscriptions and deduplicates stored event IDs. Settings adds `announce_completed_tasks=False`, `speech_voice_id=None`, `speech_volume=80`, `speech_rate=0`.

- [ ] Write tests asserting disabled/child/cancel/error/replayed completion events never speak, parent event speaks once, redacted keys/code/URLs excluded, reports <=600 characters, literal text flags, installed-voice allowlist, invalid volume/rate rejection, Stop purges queue and mute prevents wake re-arm.
- [ ] Run `.venv-glitch\Scripts\python.exe -m unittest glitch.tests.test_speech_output -v`; confirm failures.
- [ ] Implement dynamic `SAPI.SpVoice` on a dedicated initialized COM thread, async literal-text Speak and explicit purge. Enumerate installed voices, avoid generated typelib caches and bound the queue. Strip markup and use existing secret redaction; never feed raw tool outputs to speech. Hold reports during dictation, close capture before playback, then re-arm only consented wake listening.
- [ ] Run tests with injected COM adapter; separately verify installed voice enumeration and user-enabled audible Test voice/Stop in a frozen build. Speech failure must not fail the completed task.
- [ ] Commit speech service, completion routing and tests.

### Task 5: Native Controls, Packaging And Delivery

**Files:** Modify `glitch/api.py`, `main.py`, `glitch/ui/index.html`, `glitch/ui/app.js`, `glitch/ui/style.css`, `glitch/tests/smoke_desktop.py`, `.github/workflows/glitch-windows.yml`, `glitch/README.md`, `glitch/RELEASE_NOTES.md`; new `glitch/tests/test_voice_api.py`, `glitch/tests/smoke_voice.py`.

**Interfaces:** Native bridge exposes `voice_status`, `setup_voice`, `cancel_voice_setup`, `start_dictation`, `stop_dictation`, `cancel_dictation`, `set_wake_enabled`, `mute_voice`, `list_speech_voices`, `test_voice`, `read_latest_reply`, `stop_speaking`. These call services defined above; no microphone API is exposed as an agent tool. Bootstrap/poll include audio snapshots without PCM audio.

- [ ] Write API/native UI tests for explicit opt-in, first-time model setup, live preview, finalized text preserving draft, no automatic submission, Cancel, chat switch, keyboard Send while recording, voice settings validation, completion deduplication and global mute/Stop.
- [ ] Run targeted tests and native smoke before implementation; confirm missing controls/contracts fail.
- [ ] Wire microphone toggle/live preview and a Voice settings section with setup progress, hands-free consent, persistent listening state, completion toggle and voice/rate/volume controls. Stop recording before Send; closing/settings failures must preserve the existing save-and-close contract. Subscribe backend completion events once rather than speaking from replayed UI polling.
- [ ] Wire shutdown: unsubscribe completion reports, stop capture/playback and close services before agent/runtime teardown. Run full tests and four-agent plus offline voice fixture smoke in source/frozen builds; record actual microphone/speaker verification separately from CI fixture checks.
- [ ] Update privacy/setup documentation and release notes, review diffs/credentials, then commit/push and publish only after both runtime and voice release gates pass. Do not replace the user's running executable.

## Self-Review

The spec's dictation, hands-free, completion, privacy and shutdown requirements map to Tasks 1-5. All five review risks have explicit tests. Installed voice enumeration is not audible playback proof; fixture recognition is not hardware microphone proof. No unreviewed cloud service or wake-triggered task submission is introduced.
