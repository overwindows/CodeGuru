#!/bin/bash
# Update CodeGuru from source
set -euo pipefail

REPO_ROOT="/nvmedata/chenw/CodeGuru"
INSTALL_DIR="/root/.local/bin"
CONDA_ENV="codeguru"

source /root/miniconda3/etc/profile.d/conda.sh
conda activate "$CONDA_ENV"

cd "$REPO_ROOT"

echo "Updating CodeGuru..."

# Pull latest if in a git repo
if [[ -d .git ]]; then
    echo "Pulling latest changes..."
    git pull --ff-only 2>/dev/null || echo "git pull failed or not a git repo, continuing..."
fi

# Try to build
echo "Attempting build..."
if bun build --compile --target=bun-linux-x64 --outfile=dist/codeguru ./src/entrypoints/cli.tsx 2>/dev/null; then
    echo "Build succeeded"
else
    echo "Build failed (missing internal packages?), checking for existing dist..."
    if [[ ! -f dist/codeguru ]]; then
        echo "ERROR: No working binary found. You may need internal packages to build."
        exit 1
    fi
fi

# Install
echo "Installing to $INSTALL_DIR/codeguru..."
cp dist/codeguru "$INSTALL_DIR/codeguru"
chmod +x "$INSTALL_DIR/codeguru"

echo ""
echo "Updated! Version:"
"$INSTALL_DIR/codeguru" --version