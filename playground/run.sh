#!/usr/bin/env bash
# Launch the playground server.
# Usage: ./run.sh [port]
set -euo pipefail
PORT="${1:-8000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Allow overriding the conda env name.
ENV_NAME="${PLAYGROUND_ENV:-playground}"
# shellcheck disable=SC1091
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate "$ENV_NAME"
cd "$SCRIPT_DIR"
exec uvicorn server:app --host 127.0.0.1 --port "$PORT" --log-level info
