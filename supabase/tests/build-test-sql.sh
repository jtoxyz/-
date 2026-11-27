#!/usr/bin/env bash
# 使い方: bash supabase/tests/build-test-sql.sh [--with-migrations]
# 1つのトランザクションで「(マイグレーション)＋フィクスチャ＋各テスト」を流し、最後に rollback するSQLを標準出力に出す。
# 出力を Supabase MCP の execute_sql の query に渡す。通れば最後に 'ALL TESTS PASSED' が返る。
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$(dirname "$here")")"
echo 'begin;'
if [ "${1:-}" = "--with-migrations" ]; then
  # 接頭辞（タイムスタンプ）は本番のバージョンに付け替えられるので、サフィックスで探す
  count=0
  for suffix in _staff_confirmed_payment_schema.sql _staff_payment_rpcs.sql _admin_payment_receipts.sql; do
    matches=("$root"/supabase/migrations/*"$suffix")
    if [ ! -e "${matches[0]}" ]; then
      echo "ERROR: マイグレーションが見つかりません: *$suffix" >&2
      exit 1
    fi
    for f in "${matches[@]}"; do
      echo "-- migration: $(basename "$f")"
      cat "$f"
      echo
      count=$((count + 1))
    done
  done
  if [ "$count" -eq 0 ]; then
    echo "ERROR: マイグレーションが1つも見つかりません" >&2
    exit 1
  fi
fi
echo "-- fixtures"
cat "$here/staff_confirmed_payment_fixtures.sql"
echo
for f in "$here"/staff_confirmed_payment_*.test.sql; do
  [ -e "$f" ] || continue
  echo "-- test: $(basename "$f")"
  echo 'savepoint t;'
  cat "$f"
  echo
  echo 'reset role;'
  echo 'rollback to savepoint t;'
done
echo "select 'ALL TESTS PASSED' as result;"
echo 'rollback;'
