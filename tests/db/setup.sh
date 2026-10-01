#!/usr/bin/env bash
# Tạo CSDL kiểm thử trống, nạp mô phỏng Supabase + migration + seed.
set -euo pipefail
DB="${1:-khoai_test}"
export PGPASSWORD=test PGHOST=127.0.0.1 PGUSER=khoai_test
dropdb --force --if-exists "$DB"; createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$(dirname "$0")/supabase_shim.sql"
for f in "$(dirname "$0")"/../../supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$(dirname "$0")/../../supabase/seed.sql"
echo "OK: $DB"
