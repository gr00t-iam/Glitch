# Start using Glitch

Glitch is a Windows desktop AI companion. Give it a task in plain language, watch its execution timeline, and approve consequential actions before they run.

## First launch

1. Get **Glitch.exe** from [the latest release](https://github.com/gr00t-iam/Glitch/releases/latest).
2. Ensure Microsoft Edge WebView2 Runtime is installed. No Ollama or LM Studio is needed.
3. Double-click **Glitch.exe**. There is no terminal or development server to keep open.
4. Use **Projects +** to select a trusted folder.
5. Open **Settings & connections > Model Manager**. Paste a public Hugging Face URL ending in `.gguf`, click **Download model**, then select the downloaded file and click **Load model**. You can also **Import GGUF file** from your PC. Keep **Supervision > Execution mode** on **Worker only** for local use.
6. Ask Glitch to inspect your project. Review the timeline and any approval request.

The repository's **Start Glitch.cmd** is an optional shortcut: it opens the packaged executable beside it or in `dist/`. If no executable exists, it opens the release download page. It does not start a server or install dependencies.

## Optional connections

- **Hybrid supervision:** configure a developer API key (OpenRouter, OpenAI or Anthropic), or a provider-authorized local account bridge in **Supervision**. Audits share the task and recent redacted action records. Subscription bridge mode requires a separately configured, authorized bridge; it is not a Claude Pro API login.
- **Discord control:** configure a bot token and your User ID. Use a private channel or owner-only direct messages. Leave Glitch running when assigning remote tasks.
- **Chrome and desktop tasks:** install Chrome. Browser DOM tools work with text models. Screenshot reasoning requires a compatible LLaVA 1.5 model and projector selected in Model Manager. Browser and desktop actions require approval.

## If something fails

- **No models found:** download or import a single GGUF file in Model Manager. Repository links and split model parts are not accepted.
- **Model fails to load:** select a supported instruction-tuned GGUF that fits your RAM. Lower the context length or use a smaller quantized model. An old external-server model name is not a local GGUF file.
- **Stop interrupts local inference:** reload the model before continuing. Canceling an active native generation releases the inference process.
- **Download fails:** use a public, ungated HTTPS Hugging Face file URL without query parameters. Check disk space. No partial or checksum-mismatched model is added to the library.
- **Desktop window cannot initialize:** check Microsoft Edge WebView2 Runtime.
- **Browser task unavailable:** install Google Chrome; Glitch uses an isolated profile, not your existing browsing session.
- **Tests/build tools missing:** install the relevant project toolchain. It is not included in Glitch.
- **Startup configuration warning:** open Settings and correct the endpoint or Discord ID. Invalid optional environment values no longer prevent the dashboard from opening.

Do not delete your data to troubleshoot. Conversations and Windows-encrypted settings are stored under `%LOCALAPPDATA%\Glitch`.

See [the full guide](glitch/README.md) for privacy, approvals, Discord setup and developer build instructions.
