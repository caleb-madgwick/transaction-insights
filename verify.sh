#!/usr/bin/env bash
# Run all automated checks. Used locally and by CI.
set -euo pipefail
cd "$(dirname "$0")/backend"
python3 -m pytest
