#!/usr/bin/env bash
# export_d1.py 산출물을 D1에 넣는다.  사용: d1/import.sh --local | --remote
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:---local}"
for f in d1/schema.sql d1/valid-*.sql d1/pool.sql; do
	echo "== $f"
	npx wrangler d1 execute kordle "$target" --file="$f" -y 2>&1 | grep -E "Executed|rows_written|error|Error" | head -3 || true
done
