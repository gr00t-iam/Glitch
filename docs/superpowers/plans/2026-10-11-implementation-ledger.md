# Glitch 1.2.0 Execution Ledger

Approved: shared-model agents, offline dictation, Hey Glitch activation and spoken completion reports, 2026-10-11. Execution: direct implementation in this session.

- Runtime assets: pinned b11552 archive verified and extracted; malicious-path/link tests failed before implementation, then passed.
- Coordinator: capacity/cancellation, parent-child isolation and scoped approval tests passed. Existing safety and conversation tests remain passing.
- Real inference: four active server slots observed with one PID/GGUF; cancel one, complete three, reuse slot and shutdown passed.
- Voice: verified initial official publisher archive SHA256 `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498`. This is an observed download hash, not a publisher-signed attestation. Offline synthetic positive/negative wake and dictation fixtures passed; SAPI voices enumerated without speaker playback.
- Native UI: live partial/final preview, draft preservation, Cancel, no automatic Send, default-off voice controls and agent cards passed alongside previous UI/safety regressions.
- Ruling: Serialize workspace mutations with one canonical workspace lock rather than finer per-path locks -- prevents writes interleaving with test/build commands -- cost: independent writes within a workspace are serialized.
- Ruling: Disable Jinja chat parsing in the pinned server -- real tiny-GGUF schema generation failed with it enabled and passed with legacy template parsing -- cost: models needing unsupported custom Jinja templates may require a later compatible template option; fail visibly rather than execute malformed decisions.
- Ruling: Override only the smoke fixture's training-context metadata to 4,096 -- its actual metadata caps at 128 and cannot exercise long concurrent constrained output -- cost: this proves scheduling/cancellation, not model quality or 30B hardware capacity. Production has no override and rejects silently reduced contexts.
- Independent review was attempted; reviewer could not start due account usage limit. Continue with explicit self-review and regression tests; do not claim independent review occurred.
- Final regression suite: 58 tests, 57 passed and one Windows symlink-permission skip. Source and frozen parallel/voice/native UI checks passed. Frozen UI verifies live-preview/final/Cancel behavior without microphone capture; synthetic speech fixtures exercise actual Vosk recognition.
- Shipping controls: Agents + starts named independent tasks; Stream capacity/cache allocation is visible in Model Manager; Voice settings contain setup, wake, announcements and voice/volume/rate. Start Glitch.cmd selects the new versioned executable without replacing the old running file.

Outstanding hardware evidence: actual human microphone/wake phrase in a noisy room and audible speaker playback are not exercised automatically. No microphone or speaker was activated without user consent.

Packaging correction: the obsolete frozen llama-cpp-python smoke failed although its source check and the shipped shared runtime passed. Remove the unused adapter's native libraries from the executable rather than ship two incompatible inference stacks. Both single-stream and parallel gates now exercise the shipped runtime; legacy adapter source remains for historical tests only.
