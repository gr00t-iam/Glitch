# Glitch: Offline Dictation And Spoken Completion Reports

Status: Approved by the user on 2026-10-11; implemented for Glitch 1.2.0. Actual microphone/noisy-room and audible speaker verification remain user-device checks; see the execution ledger.

## Intent

Add an explicit microphone toggle, optional "Hey Glitch" activation and optional speaker announcements alongside the approved shared-model sub-agents. These features require no cloud speech service, Ollama, Node.js or user-managed terminal.

## Dictation

- Bundle Vosk and sounddevice/PortAudio in the Windows executable. Offer a one-time in-app download of the Apache-licensed `vosk-model-small-en-us-0.15` English recognizer. Recognition is offline after setup; it does not occupy a GGUF inference slot.
- Never enable microphone capture from an agent tool or Discord. Capture requires the user's microphone toggle or explicit opt-in to hands-free listening, and a ready speech model. A connected/enabled Windows microphone alone is not consent to listen.
- Show a distinct live transcript preview. Commit finalized utterances once into the current draft, preserving existing typed text. Stop flushes the remaining transcript; Cancel discards the current recording contribution and preserves the original draft. Never automatically submit a task.
- Bind results to a conversation and recording generation. Switching conversations or closing the app cancels capture. Late results cannot edit another conversation. Sending requires recording to finish first.
- Limit recordings to 120 seconds, drafts to the existing 20,000-character task limit, and the PCM queue to a bounded buffer. Device loss, permissions, overflow and unavailable models produce a visible error and release the microphone. Audio stays in memory and is discarded, not saved as a recording.
- English is the first supported recognition language. Do not promise cloud-quality accuracy; allow corrections before Send.

## Hey Glitch Hands-Free Mode

- Add a saved **Listen for Hey Glitch** toggle, disabled by default. On first enable, explain that the default microphone remains open for local wake detection while Glitch is running. Show persistent Off / Listening for Hey Glitch / Dictating / Speaking / Microphone unavailable states and a global mute control.
- Use an offline constrained Vosk phrase recognizer for `hey glitch` plus unknown speech rejection. Activation requires a finalized exact phrase and confidence filtering, not a substring match in ordinary conversation. Start with minimum per-word confidence 0.85; calibrate against recorded positive/negative fixtures before shipping and expose false-activation limitations honestly.
- Keep only a bounded rolling audio buffer in RAM. Discard unrelated speech and do not store it, add it to conversation history, or send it to any model. Strip the activation phrase from the draft. The microphone cannot operate after the application exits.
- On activation, display the live preview and begin normal dictation without a button press. Stop after two seconds of silence following speech, or ten seconds without speech after activation. Keep the 120-second recording ceiling. Finalize into the draft only, never auto-submit or execute a command.
- Apply a three-second activation cooldown after dictation ends. If there is no active conversation, prepare a normal conversation using the existing managed workspace fallback before accepting dictation; do not silently change the user's selected project.
- Close capture during speaker playback. Re-arm wake listening afterward only if hands-free remains explicitly enabled; never resume an interrupted dictation. Turning hands-free off or muting disables re-arming immediately. A conversation change discards current recording and re-arms only under the existing opt-in.
- Handle default device changes by showing a recoverable device state and reopening only when explicitly opted in. No hidden retry loop after microphone permission denial.

## Spoken Reports

- Use installed Windows SAPI voices locally, with a dedicated COM thread. Speech must not block the UI or agent execution.
- Add an opt-in, saved **Speak when a task finishes** setting, disabled by default, with voice, volume (0-100), rate (-10 to 10), Test voice and Stop Speaking controls.
- Speak a short final report for completed parent tasks only. Do not announce each sub-agent action, cancelled tasks, failed tasks or replayed history. Deduplicate announcements by completion event ID.
- Limit reports to 600 characters of plain text. Strip code blocks, URLs and markup, redact known secrets, and never read raw tool payloads, terminal logs or file contents automatically. Provide a manual Read latest reply action with the same filtering.
- Treat all speech as literal text, never XML/SSML or a filename. Voice selection is limited to enumerated installed voice IDs.
- If completion occurs during dictation, hold the report until recording ends. Close capture before speaker playback; afterward resume only explicitly opted-in wake listening, never dictation. Turning announcements off purges pending automatic reports.
- If speakers/voices fail, keep the visible completion report and show a nonblocking speech error. On shutdown, stop playback and release audio/COM resources.

## Implementation Boundary

Use Vosk rather than WebView2 browser speech recognition or the optional Windows System.Speech assembly. Use SAPI COM rather than a cloud TTS API. Installed David/Zira voices have been enumerated on this host, but actual microphone recognition and speaker playback still require verification.

## Evidence Required

1. Partial/final/Stop/Cancel sequences preserve drafts and never submit; conversation switches reject late results.
2. Offline recorded-audio recognition passes in source and frozen builds; microphone permissions/device loss are tested separately on hardware.
3. Installed voice enumeration, playback completion, Stop, and thread shutdown pass in the frozen build; actual audible output requires a user-enabled speaker test.
4. Only one parent completion announcement is queued per event, with no sensitive payloads or historical replay.
5. Recording and speaker playback cannot overlap; four active agents remain responsive during voice input/output.
6. Positive/negative wake fixtures exercise exact phrase, confidence, cooldown, silence timeout, mute, device changes and shutdown. Actual room/background-noise tests are separate from fixture tests.

## References

- [Vosk microphone example](https://github.com/alphacep/vosk-api/blob/master/python/example/test_microphone.py)
- [Vosk model catalog](https://alphacephei.com/vosk/models)
- [Windows SAPI Speak flags](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms723609(v=vs.85))
- [comtypes dynamic COM objects](https://comtypes.readthedocs.io/en/stable/client.html)
