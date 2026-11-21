#!/usr/bin/env bash
# Run all automated checks. Used locally and by CI. Dependencies must already be installed.
set -euo pipefail
cd "$(dirname "$0")"
(cd backend && python3 -m pytest)
(cd frontend && npm run build)
