# Start using Glitch

Glitch is a Windows desktop AI companion. Give it a task in plain language, watch its execution timeline, and approve consequential actions before they run.

## First launch

1. Get **Glitch.exe** from [the latest release](https://github.com/gr00t-iam/Glitch/releases/latest).
2. Ensure Microsoft Edge WebView2 Runtime is installed. No Ollama or LM Studio is needed.
3. Double-click **Glitch.exe**. There is no terminal or development server to keep open.
4. Optionally use **Projects +** to select a trusted folder for existing project files. Ordinary chat works without choosing a folder; Glitch creates a chat workspace automatically.
5. Open **Settings & connections > Model Manager**. Paste a public Hugging Face URL ending in `.gguf`, click **Download model**, then select the downloaded file and click **Load model**. You can also **Import GGUF file** from your PC. Keep **Supervision > Execution mode** on **Worker only** for local use.
6. Ask Glitch to inspect your project. Review the timeline and any approval request.

Context length accepts up to 131,072 tokens, including 65,535, subject to model support and available RAM. **Save settings** closes the settings window after saving successfully.

For unattended actions, use the **Full access** control in the chat composer, or **Computer & safety > Full Access**. Confirm when enabling it. It skips individual prompts for supported tools, including authorized Discord tasks, and stays on after restart. Turn it off to restore prompts. Workspace boundaries, protected files, command allowlists and Stop remain enforced; Full Access does not grant administrator rights.

The repository's **Start Glitch.cmd** is an optional shortcut: it opens the packaged executable beside it or in `dist/`. If no executable exists, it opens the release download page. It does not start a server or install dependencies.

## Parallel agents and voice

In **Model Manager**, choose **Parallel streams** (1-4) before loading. All streams share one model and one total context pool; a 65,535-token setting is not multiplied by the agent count. Automatic processing selects NVIDIA CUDA when available, with CPU fallback. Use **Agents +** to assign another task; each card has Open and Stop controls. More streams share the GPU's throughput and may slow individual answers.

In **Settings & connections > Voice**, click **Set up offline voice** once. **Mic** shows your words live and places the finished transcript in the input; Send remains manual. Optionally enable **Listen for Hey Glitch**, then say that phrase, pause briefly and dictate. The default microphone listens locally only while Glitch is running. **Mute** turns hands-free off.

Enable **Speak when a task finishes** to hear short reports through your speakers. Choose a Windows voice, adjust volume/rate, then **Test voice**. Listening pauses during playback; **Stop speaking** cancels it. Both voice options default off.

## Optional connections

- **Hybrid supervision:** configure a developer API key (OpenRouter, OpenAI or Anthropic), or a provider-authorized local account bridge in **Supervision**. Audits share the task and recent redacted action records. Subscription bridge mode requires a separately configured, authorized bridge; it is not a Claude Pro API login.
- **Discord control:** configure a bot token and your User ID. Use a private channel or owner-only direct messages. Leave Glitch running when assigning remote tasks.
- **Chrome and desktop tasks:** install Chrome. Browser DOM tools work with text models. Screenshot reasoning requires a compatible LLaVA 1.5 model and projector selected in Model Manager. Browser and desktop actions require approval.

## If something fails

For GitHub projects, save a repository-scoped fine-grained PAT in **GitHub
connections**, validate it and bind your project. Ask for review/push/PR work,
or choose **Pull current branch** and send the prepared local-only task. Read
validation is not write permission; publication still prompts in Full Access.
Removing a project leaves its disk files intact. Context refresh keeps the
archive, not unlimited model memory. [Credential and history details](glitch/README.md#credentials-github-and-history).

- **No models found:** download or import a single GGUF file in Model Manager. Repository links and split model parts are not accepted.
- **Model fails to load:** select a supported instruction-tuned GGUF that fits your RAM. Lower the context length or use a smaller quantized model. An old external-server model name is not a local GGUF file.
- **Stop interrupts local inference:** only the selected stream stops; other agents keep working and the model remains loaded. Reload if the entire model process failed.
- **Muse Glimmer tried to load a CLIP model:** version 1.2.1 repairs a saved vision projector pointing at the language model itself. Leave the projector on **Text / browser DOM only** unless you have a separate compatible vision file.
- **Download fails:** use a public, ungated HTTPS Hugging Face file URL without query parameters. Check disk space. No partial or checksum-mismatched model is added to the library.
- **Desktop window cannot initialize:** check Microsoft Edge WebView2 Runtime.
- **Browser task unavailable:** install Google Chrome; Glitch uses an isolated profile, not your existing browsing session.
- **Tests/build tools missing:** install the relevant project toolchain. It is not included in Glitch.
- **Startup configuration warning:** open Settings and correct the endpoint or Discord ID. Invalid optional environment values no longer prevent the dashboard from opening.

Do not delete your data to troubleshoot. Conversations and Windows-encrypted settings are stored under `%LOCALAPPDATA%\Glitch`.

See [the full guide](glitch/README.md) for privacy, approvals, Discord setup and developer build instructions.
