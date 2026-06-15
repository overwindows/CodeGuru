#!/usr/bin/env bash
# Install CodeGuru CLI dependencies on macOS / Linux.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_DIR="${HOME}/.codeguru"
SETTINGS_FILE="${SETTINGS_DIR}/settings.json"
EXAMPLE_SETTINGS="${REPO_ROOT}/scripts/settings.example.json"

info()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
die()   { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

ensure_node() {
  if command_exists node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" -ge 18 ]]; then
      ok "[ok] Node.js $(node --version)"
      return
    fi
    warn "Node.js $(node --version) found but 18+ is required"
  fi

  info "Node.js 18+ not found."
  if [[ "$(uname -s)" == "Darwin" ]] && command_exists brew; then
    info "Installing fnm via Homebrew..."
    brew install fnm
    eval "$(fnm env --use-on-cd)"
    fnm install 22
    fnm use 22
  elif command_exists curl; then
    info "Installing fnm..."
    curl -fsSL https://fnm.vercel.app/install | bash
    # shellcheck disable=SC1091
    source "${HOME}/.bashrc" 2>/dev/null || true
    if [[ -f "${HOME}/.zshrc" ]]; then
      # shellcheck disable=SC1090
      source "${HOME}/.zshrc" 2>/dev/null || true
    fi
    fnm install 22
    fnm use 22
  else
    die "Install Node.js 18+ manually: https://nodejs.org/"
  fi
  ok "[ok] Node.js $(node --version)"
}

ensure_bun() {
  if command_exists bun; then
    ok "[ok] Bun $(bun --version)"
    return
  fi

  info "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  command_exists bun || die "Bun install failed. See https://bun.sh/docs/installation"
  ok "[ok] Bun $(bun --version)"
}

install_npm_deps() {
  cd "${REPO_ROOT}"
  info "Installing npm dependencies..."
  npm install --legacy-peer-deps
  info "Pinning React 19 packages..."
  npm install react@^19.0.0 react-reconciler@0.34.0-canary-ed69815c-20260323 --legacy-peer-deps
  ok "[ok] Dependencies installed"
}

ensure_settings() {
  if [[ -f "${SETTINGS_FILE}" ]]; then
    ok "[ok] Settings already exist at ${SETTINGS_FILE}"
    return
  fi
  mkdir -p "${SETTINGS_DIR}"
  cp "${EXAMPLE_SETTINGS}" "${SETTINGS_FILE}"
  ok "[ok] Created ${SETTINGS_FILE} from template — edit and add your API key"
}

main() {
  info "CodeGuru install (macOS / Linux)"
  info "Repo: ${REPO_ROOT}"
  echo

  [[ -f "${REPO_ROOT}/package.json" ]] || die "package.json not found. Run from the CodeGuru repo root."

  ensure_node
  ensure_bun
  install_npm_deps
  ensure_settings

  echo
  ok "Install complete."
  info "Next steps:"
  info "  1. Edit ${SETTINGS_FILE} and set CODEGURU_AUTH_TOKEN"
  info "  2. bun run dev"
  info "  3. python3 scripts/check-dev-environment.py  (optional check)"
}

main "$@"
