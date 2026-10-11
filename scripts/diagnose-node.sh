#!/usr/bin/env bash
set -u

echo "== Node/NPM diagnostics =="
echo "node path: $(command -v node || echo 'not found')"
node --version 2>/dev/null || echo "node unavailable"
echo "npm path: $(command -v npm || echo 'not found')"
npm --version 2>/dev/null || echo "npm unavailable"
echo
echo "== npm prefix =="
npm prefix -g 2>/dev/null || echo "could not read global prefix"
echo
echo "== npm doctor =="
npm doctor 2>/dev/null || echo "npm doctor failed; npm may be missing or misconfigured"
echo
echo "== prefix permissions =="
prefix="$(npm prefix -g 2>/dev/null || true)"
if [ -n "$prefix" ]; then
  ls -ld "$prefix" 2>/dev/null || true
else
  echo "No npm prefix available."
fi
