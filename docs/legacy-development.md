# Glitch legacy prototypes

These sources are retained for maintainers, not the supported consumer application. End users should download `Glitch.exe` and follow the root README.

| Path | Prototype |
| --- | --- |
| `src/`, `public/`, `index.html` | React/Vite browser interface and PWA assets. |
| `vite.config.ts`, `runtime/`, `tools/`, `skills/` | Development runtime and tool/plugin experiments. |
| `desktop/` | Electron shell and older supervisor-worker runtime. |
| `server/`, `docs/host-bridge-lxc.md` | Python sidecars and managed-host experiments. |
| `self-edit/` | Prototype self-edit workflow. |

For prototype work only, install Node dependencies, run `npm test` and `npm run build`, and use `npm run dev` or `npm run desktop` as appropriate. These are not instructions for running the shipped desktop application.

The legacy backend assumes a trusted development setup. Do not publish local filesystem, shell, terminal or debugging endpoints to a public or shared host without a separate security review.

Prototype browser database and credential identities remain stable to keep existing data readable. New exports and visible branding use Glitch. Native app conversations and DPAPI keys are unaffected by the rebrand. Filesystem prototype metadata now uses `.glitch/`; back up and move any earlier prototype metadata there before resuming that development workflow.

An old fixed browser credential derivation is compatibility behavior, not the production secret store. The supported executable uses Windows DPAPI instead.
