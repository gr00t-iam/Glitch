#!/usr/bin/env bash
set -u

cat <<'EOF'
Glitch npm repair guide

This script does not mutate your system. It prints safe repair steps.

Common fixes:
1. Prefer nvm/nvm-windows so global packages do not require admin rights.
2. Confirm node and npm point to the same installation:
   which node
   which npm
   node --version
   npm --version
3. If npm points to a deleted AppData/Roaming path on Windows, reinstall Node.js or nvm-windows.
4. Avoid chmod/chown on system folders unless you know the exact prefix and owner.
5. After repair, run:
   npm install
   npm test

If the project still fails, run scripts/diagnose-node.sh and attach the output.
EOF
