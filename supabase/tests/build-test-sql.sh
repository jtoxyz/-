#!/usr/bin/env bash
# 使い方: bash supabase/tests/build-test-sql.sh [--with-migrations]
# 1つのトランザクションで「(マイグレーション)＋フィクスチャ＋各テスト」を流し、最後に rollback するSQLを標準出力に出す。
# 出力を Supabase MCP の execute_sql の query に渡す。通れば最後に 'ALL TESTS PASSED' が返る。
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$(dirname "$here")")"
echo 'begin;'
if [ "${1:-}" = "--with-migrations" ]; then
  for f in "$root"/supabase/migrations/20261126000*_*.sql; do
    [ -e "$f" ] || continue
    echo "-- migration: $(basename "$f")"
    cat "$f"
    echo
  done
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
