import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const REMOTE_DEBUGGING_PORT = process.env.NEXUS_CDP_PORT ?? "9222";
const HEADLESS = process.env.NEXUS_CHROME_HEADLESS !== "0";
const REPLACE_EXISTING = process.env.NEXUS_REPLACE_EXISTING === "1";
const userDataDir =
  process.env.NEXUS_CHROME_USER_DATA_DIR ?? mkdtempSync(join(tmpdir(), `nexusharness-chrome-${REMOTE_DEBUGGING_PORT}-`));
const startUrl = process.env.NEXUS_CHROME_START_URL ?? "about:blank";

const chromePath = findChromeExecutable();
if (!chromePath) {
  console.error("Google Chrome was not found. Install Chrome or set NEXUS_CHROME_PATH to the Chrome executable.");
  process.exit(1);
}

if (REPLACE_EXISTING) {
  stopExistingDebugChrome();
}

const args = [
  `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-mode",
  "--window-size=1440,1000",
  ...(HEADLESS ? ["--headless=new", "--disable-gpu"] : []),
  startUrl,
];

const child = spawn(chromePath, args, {
  detached: true,
  stdio: "ignore",
});

child.unref();

console.log(`Launched ${HEADLESS ? "embedded" : "visible"} Google Chrome for NexusHarness.`);
console.log(`Remote debugging: http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
console.log(`Isolated profile: ${userDataDir}`);

function findChromeExecutable() {
  if (process.env.NEXUS_CHROME_PATH && existsSync(process.env.NEXUS_CHROME_PATH)) {
    return process.env.NEXUS_CHROME_PATH;
  }

  const platform = process.platform;
  const candidates =
    platform === "win32"
      ? windowsCandidates()
      : platform === "darwin"
        ? macCandidates()
        : linuxCandidates();

  return candidates.find((candidate) => existsSync(candidate));
}

function windowsCandidates() {
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  return roots.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"));
}

function macCandidates() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
  ];
}

function linuxCandidates() {
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

function stopExistingDebugChrome() {
  const portFlag = `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`;

  try {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -like '*${portFlag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
        ],
        { stdio: "ignore" },
      );
      return;
    }

    execFileSync("pkill", ["-f", portFlag], { stdio: "ignore" });
  } catch {
    // No matching debugging browser was running.
  }
}
