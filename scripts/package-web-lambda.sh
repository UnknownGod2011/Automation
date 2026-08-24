#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$ROOT_DIR/dist/automation-web-lambda.zip}"
command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 2; }
command -v zip >/dev/null || { echo "zip is required" >&2; exit 2; }

pnpm --dir "$ROOT_DIR" --filter @automation/web build >/dev/null
standalone="$ROOT_DIR/apps/web/.next/standalone"
[[ -d "$standalone" ]] || { echo "Next.js standalone output is missing" >&2; exit 3; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -a "$standalone/." "$work/"
if [[ -f "$work/apps/web/server.js" ]]; then
  server_dir="apps/web"
  mkdir -p "$work/apps/web/.next"
  cp -a "$ROOT_DIR/apps/web/.next/static" "$work/apps/web/.next/static"
  [[ ! -d "$ROOT_DIR/apps/web/public" ]] || cp -a "$ROOT_DIR/apps/web/public" "$work/apps/web/public"
elif [[ -f "$work/server.js" ]]; then
  server_dir="."
  mkdir -p "$work/.next"
  cp -a "$ROOT_DIR/apps/web/.next/static" "$work/.next/static"
  [[ ! -d "$ROOT_DIR/apps/web/public" ]] || cp -a "$ROOT_DIR/apps/web/public" "$work/public"
else
  echo "standalone server.js is missing" >&2; exit 3
fi
cat >"$work/run.sh" <<EOF
#!/bin/sh
set -eu
cd "\$(dirname "\$0")/$server_dir"
export PORT="\${PORT:-8080}"
exec node server.js
EOF
chmod 755 "$work/run.sh"
# Never package local environment files or source maps containing deployment-local data.
find "$work" -type f \( -name '.env' -o -name '.env.*' \) -delete
mkdir -p "$(dirname "$out")"; rm -f "$out"
(cd "$work" && zip -q -r "$out" .)
python3 - "$out" <<'PY'
import sys, zipfile
p=sys.argv[1]
with zipfile.ZipFile(p) as z:
    names=set(z.namelist())
    if "run.sh" not in names: raise SystemExit("web artifact missing run.sh")
    if not ({"server.js","apps/web/server.js"}&names): raise SystemExit("web artifact missing standalone server.js")
    if any(n == ".env" or "/.env" in n or n.startswith(".env.") for n in names): raise SystemExit("web artifact contains an environment file")
print(p)
PY
