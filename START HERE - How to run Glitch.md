# Start using Glitch

Glitch is a Windows desktop AI companion. Give it a task in plain language, watch its execution timeline, and approve consequential actions before they run.

## First launch

1. Get **Glitch.exe** from [the latest release](https://github.com/gr00t-iam/Glitch/releases/latest).
2. Install Ollama for Windows and download a model in Ollama.
3. Double-click **Glitch.exe**. There is no terminal or development server to keep open.
4. Use **Projects +** to select a trusted folder.
5. Open **Settings & connections**, choose **Local only**, click **Find local models**, select a downloaded model, and save.
6. Ask Glitch to inspect your project. Review the timeline and any approval request.

The repository's **Start Glitch.cmd** is an optional shortcut: it opens the packaged executable beside it or in `dist/`. If no executable exists, it opens the release download page. It does not start a server or install dependencies.

## Optional connections

- **Hybrid supervision:** configure a cloud API endpoint, model, and key in Settings. Audits share the task and recent redacted action records with that provider.
- **Discord control:** configure a bot token and your User ID. Use a private channel or owner-only direct messages. Leave Glitch running when assigning remote tasks.
- **Chrome and desktop tasks:** install Chrome and use a vision-capable local model for screenshot reasoning. Browser and desktop actions require approval.

## If something fails

- **No models found:** ensure Ollama is running, the endpoint is correct, and a model is downloaded.
- **Desktop window cannot initialize:** check Microsoft Edge WebView2 Runtime.
- **Browser task unavailable:** install Google Chrome; Glitch uses an isolated profile, not your existing browsing session.
- **Tests/build tools missing:** install the relevant project toolchain. It is not included in Glitch.
- **Startup configuration warning:** open Settings and correct the endpoint or Discord ID. Invalid optional environment values no longer prevent the dashboard from opening.

Do not delete your data to troubleshoot. Conversations and Windows-encrypted settings are stored under `%LOCALAPPDATA%\Glitch`.

See [the full guide](glitch/README.md) for privacy, approvals, Discord setup and developer build instructions.
