# Shared context and CUDA correction

Approved by the user: one Muse Glimmer model, one 65,535-token aggregate context pool, up to four independent streams on RTX 4090 / 24 GB VRAM / 32 GB RAM. This supersedes the per-agent cache allocation in the original 1.2.0 design, not the independent-history or safety contracts.

## Implemented

- One physical unified KV buffer with continuous batching. No context multiplication or fixed per-slot partition.
- Model-native prompt token counting, aggregate prompt/output reservations, cancellation-aware FIFO waiting, bounded host prompt cache and no silent history truncation.
- Pinned llama.cpp b11552 CPU and CUDA 12.4 archives plus CUDA redistributables; automatic device detection, GPU layer fitting and explicit CPU/CUDA modes.
- Migration of a saved language-model-as-projector configuration. Reject new invalid projector selections.
- Native Jinja formatting: real-model test initially failed with the legacy formatter; server logs explicitly required `--jinja`. Production now enables it. The checksum-pinned stories fixture alone retains legacy formatting in smoke tests.
- Microphone icon, inline Full Access confirmation and Send arrow; removed Read reply while retaining optional completion speech.

## Evidence

Source acceptance used the actual 16,756,683,904-byte Muse Glimmer GGUF. Four requests overlapped in one CUDA PID, sharing 65,535 configured tokens (65,536 physical alignment). Cancelling one preserved three sibling completions. Total peak GPU usage was 18,983 MiB, with 1,926 MiB baseline. The owned runtime shut down cleanly. This proves inference/concurrency within the hardware, not task quality or four independent 65k conversations.

Native WebView2 checks confirm icon rendering, no Read reply, permission-confirmation cancellation, enable/disable synchronization, preserved approvals and dictation draft behavior. Synthetic voice checks do not establish real microphone or speaker accuracy. Live cloud/Discord accounts are not part of these checks.

Release review found that changing models could restore a deliberately cleared saved projector. A native regression reproduced this failure, then passed after preserving empty selections once the library is initialized. The reviewer confirmed this specific fix by static inspection; native tests remain the implementer's independent execution evidence.

## References

- [LM Studio parallel requests](https://lmstudio.ai/docs/app/advanced/parallel-requests): continuous batching, shared model runtime and configurable concurrent predictions.
- [Pinned llama.cpp server contract](https://github.com/ggml-org/llama.cpp/blob/b11552/tools/server/README.md): total context, unified KV, template/tokenization endpoints, continuous batching and GPU fitting.

## Release gates

Run regressions, source and frozen native UI, CPU fixture concurrency, offline voice fixtures and actual Muse CUDA acceptance. Build a separate versioned executable; never replace the user's running binary. Publish only tested artifacts and keep prior releases available.
