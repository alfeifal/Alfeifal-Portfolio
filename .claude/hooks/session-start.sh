#!/bin/bash
#
# Brings a fresh container to the point where `pnpm test` works.
#
# WHY THIS EXISTS. The suite talks to a real PostgreSQL — there are no database mocks in this project
# on purpose, because the things worth testing here are concurrency, cascades and constraints. Nothing
# in the repository said how to get that database, so every session rediscovered it from scratch: in
# one session alone the local cluster had to be rebuilt twice, and in between, 23 tests failed with
# "Failed query" for no reason anyone could see from the error.
#
# It is also what makes the suite honest. Three tests in tests/multi-user-admin.test.ts passed for
# weeks only because a previous session had left administrators in the database; on a freshly migrated
# one they failed immediately. A database created the same way every time is the difference between a
# green suite and a meaningful one.
#
# Everything here is idempotent: re-running it starts nothing twice and destroys nothing.
set -euo pipefail

# Only in Claude Code on the web. A developer's own machine has its own database and its own opinions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "session-start: local environment, nothing to do"
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

PG_VERSION=16
PG_PORT=5433
PG_SOCKET_DIR=/tmp
PG_DATA=/var/lib/postgresql/personal-os-test
TEST_DB=personal_os_test
# Matches the socket form the project already uses. No password: the cluster below is trust-auth and
# listens on a Unix socket in the container only, so there is no credential here to leak.
TEST_URL="postgres://postgres@localhost:${PG_PORT}/${TEST_DB}?host=${PG_SOCKET_DIR}"

say() { echo "session-start: $*"; }

# ---------------------------------------------------------------- node dependencies
say "installing node dependencies"
corepack enable >/dev/null 2>&1 || true
pnpm install --prefer-offline

# ---------------------------------------------------------------- postgres binaries
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
if [ ! -x "${PG_BIN}/initdb" ]; then
  say "installing postgresql-${PG_VERSION}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends "postgresql-${PG_VERSION}" postgresql-client-"${PG_VERSION}"
fi
# A cluster the distribution created for us would sit on 5432 and is not what the project expects;
# it is harmless and left alone.

# ---------------------------------------------------------------- the cluster
ready() { "${PG_BIN}/pg_isready" -h "${PG_SOCKET_DIR}" -p "${PG_PORT}" >/dev/null 2>&1; }

# Whatever is already answering on that socket is the database this project expects, whether a previous
# run of this hook started it or somebody started one by hand. Reuse it; do not try to bind the port a
# second time, which is how this failed the first time it was written.
if ready; then
  say "a server is already answering on ${PG_SOCKET_DIR}:${PG_PORT}"
else
  if [ ! -s "${PG_DATA}/PG_VERSION" ]; then
    say "initialising a cluster at ${PG_DATA}"
    mkdir -p "${PG_DATA}"
    chown postgres:postgres "${PG_DATA}"
    # -A trust: a throwaway cluster reachable only through a socket inside this container.
    su postgres -c "${PG_BIN}/initdb -D ${PG_DATA} -A trust -U postgres" >/tmp/personal-os-initdb.log 2>&1
  fi
  say "starting the cluster on port ${PG_PORT}"
  su postgres -c "${PG_BIN}/pg_ctl -D ${PG_DATA} \
    -o '-p ${PG_PORT} -k ${PG_SOCKET_DIR} -c listen_addresses=localhost' \
    -l /tmp/personal-os-postgres.log start" >/dev/null

  # pg_ctl returns before the socket is necessarily accepting connections.
  for _ in $(seq 1 30); do ready && break; sleep 1; done
fi

if ! ready; then
  say "could not reach PostgreSQL — see /tmp/personal-os-postgres.log"
  exit 1
fi

# ---------------------------------------------------------------- the database
if ! su postgres -c "${PG_BIN}/psql -h ${PG_SOCKET_DIR} -p ${PG_PORT} -U postgres -tAc \"select 1 from pg_database where datname='${TEST_DB}'\"" | grep -q 1; then
  say "creating ${TEST_DB}"
  su postgres -c "${PG_BIN}/createdb -h ${PG_SOCKET_DIR} -p ${PG_PORT} -U postgres ${TEST_DB}"
fi

# ---------------------------------------------------------------- environment for the session
# Only when nothing already set it: a session that has a real .env keeps whatever that says.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -q '^TEST_DATABASE_URL=' .env 2>/dev/null; then
  {
    echo "export TEST_DATABASE_URL='${TEST_URL}'"
    echo "export DATABASE_DRIVER=pg"
    echo "export DATABASE_SSL=false"
    echo "export AUTH_SECRET=\${AUTH_SECRET:-session-start-hook-test-secret}"
  } >> "${CLAUDE_ENV_FILE}"
  say "wrote TEST_DATABASE_URL to the session environment"
fi

# ---------------------------------------------------------------- schema
# --test targets TEST_DATABASE_URL and never DATABASE_URL, so this cannot reach production. The guard
# in src/server/db would refuse a remote host from a non-production process anyway.
say "applying migrations"
TEST_DATABASE_URL="${TEST_DATABASE_URL:-${TEST_URL}}" DATABASE_SSL=false pnpm db:migrate --test

say "ready — pnpm test should work"
