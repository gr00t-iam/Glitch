# Running NexusHarness

NexusHarness is a local‑first app: it runs a small server on **your own computer** and
the desktop/PWA window simply displays it. If that server isn't running, the window shows
*"Can't reach this page – 127.0.0.1 refused to connect."* That's what happened here.

## To start it

**Double‑click `Start NexusHarness.cmd`** in this folder.

- It launches the server and automatically opens NexusHarness at `http://127.0.0.1:5173`.
- The first run installs dependencies and can take a few minutes; after that it's quick.
- **Keep the small black window open** while you use the app. Closing it stops NexusHarness.

Once it's running, your installed desktop app (PWA) will work too — open it as usual.

## Tip: pin it for one‑click access

Right‑click `Start NexusHarness.cmd` → **Create shortcut**, then move the shortcut to your
Desktop or pin it to the taskbar. (Optional: in the shortcut's Properties you can set a
custom icon using `public/icons/icon-192.svg`.)

## If the desktop app still shows a blank/"refused" page

Your installed app may be pinned to an old address. Fix it once:

1. Run `Start NexusHarness.cmd` and let the browser tab open at `http://127.0.0.1:5173`.
2. In that browser tab, open the menu → **Apps → Install this site as an app**
   (or the install icon in the address bar) to re‑install the app pointing at the right address.
3. Remove the old desktop app if you like.

## What needs to be installed

- **Node.js** (LTS) — https://nodejs.org . The launcher checks for this and tells you if it's missing.
- For local AI models, **Ollama** running on its default port (`11434`) — optional; the app also
  works with OpenAI/Anthropic keys entered in *Settings & Core Runtime*.

## Optional: live web search

NexusHarness can automatically search the current web for prompts that ask for latest/current information.
Set `TAVILY_API_KEY` or `NEXUS_TAVILY_API_KEY` before starting the app to use Tavily. Without a key, the local runtime falls back to a lightweight search-and-scrape helper.
