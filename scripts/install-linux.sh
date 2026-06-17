#!/usr/bin/env bash
# Install CodeGuru CLI on Linux (system-wide or user-local).
set -euo pipefail

# ── Options ──────────────────────────────────────────────────────────────────
INSTALL_MODE="${INSTALL_MODE:-user}"   # 'user' | 'system'
FORCE="${FORCE:-}"
SKIP_DEPS="${SKIP_DEPS:-}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()   { printf "${CYAN}[info]${NC} %s\n" "$*"; }
ok()     { printf "${GREEN}[ ok ]${NC} %s\n" "$*"; }
warn()   { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
die()    { printf "${RED}[fail]${NC} %s\n" "$*" >&2; exit 1; }

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/dist"
BIN_NAME="codeguru"
SYSTEM_BIN_DIR="/usr/local/bin"
USER_BIN_DIR="${HOME}/.local/bin"
CACHE_DIR="${HOME}/.cache/codeguru"
CONFIG_DIR="${HOME}/.config/codeguru"
CONFIG_FILE="${CONFIG_DIR}/settings.json"
EXAMPLE_SETTINGS="${REPO_ROOT}/scripts/settings.example.json"

# ── Helpers ───────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" >/dev/null 2>&1; }

needs_sudo() {
  [[ "${INSTALL_MODE}" == "system" && ! -w "${SYSTEM_BIN_DIR}" ]]
}

sudo_if_needed() {
  if needs_sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

detect_distro() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    echo "${ID:-linux}"
  else
    echo "linux"
  fi
}

# ── Prerequisite checks ───────────────────────────────────────────────────────
check_node() {
  if command_exists node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" -ge 18 ]]; then
      ok "Node.js $(node --version)"
      return 0
    fi
    warn "Node.js $(node --version) found but 18+ is required"
  fi
  return 1
}

check_bun() {
  if command_exists bun; then
    ok "Bun $(bun --version)"
    return 0
  fi
  return 1
}

install_nodejs_fnm() {
  info "Installing Node.js via fnm..."
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export FNM_DIR="${HOME}/.fnm"
  export PATH="${FNM_DIR}/versions/node/$(ls "${FNM_DIR}/versions/node/" | tail -1)/installation/bin:${PATH}"
  eval "$(fnm env --shell bash)"
  fnm install 22
  fnm use 22
  ok "Node.js $(node --version)"
}

install_bun() {
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  ok "Bun $(bun --version)"
}

# ── Build ─────────────────────────────────────────────────────────────────────
build_codeguru() {
  info "Building CodeGuru CLI..."

  mkdir -p "${BUILD_DIR}"

  # Build for Linux x64
  bun build \
    --compile \
    --target=bun-linux-x64 \
    --outfile="${BUILD_DIR}/${BIN_NAME}" \
    "${REPO_ROOT}/src/entrypoints/cli.tsx" \
    || die "Build failed. Check errors above."

  chmod +x "${BUILD_DIR}/${BIN_NAME}"
  ok "Built: ${BUILD_DIR}/${BIN_NAME}"
}

# ── Install ───────────────────────────────────────────────────────────────────
install_binary() {
  local dest_dir dest_bin
  if [[ "${INSTALL_MODE}" == "system" ]]; then
    dest_dir="${SYSTEM_BIN_DIR}"
    dest_bin="${dest_dir}/${BIN_NAME}"
    info "Installing system-wide to ${dest_dir}..."
    sudo_if_needed mkdir -p "${dest_dir}"
    sudo_if_needed cp "${BUILD_DIR}/${BIN_NAME}" "${dest_bin}"
    sudo_if_needed chmod +x "${dest_bin}"
  else
    dest_dir="${USER_BIN_DIR}"
    dest_bin="${dest_dir}/${BIN_NAME}"
    mkdir -p "${dest_dir}"
    cp "${BUILD_DIR}/${BIN_NAME}" "${dest_bin}"
    chmod +x "${dest_bin}"
  fi

  # Verify
  if [[ -x "${dest_bin}" ]]; then
    ok "Installed: ${dest_bin}"
  else
    die "Binary installation failed"
  fi

  # Warn if PATH doesn't include install dir
  case ":${PATH}:" in
    *":${dest_dir}:"*) ;;
    *) warn "Add ${dest_dir} to your PATH. Add this to ~/.bashrc or ~/.zshrc:"
       warn "  export PATH=\"${dest_dir}:\$PATH\"" ;;
  esac
}

# ── Config ────────────────────────────────────────────────────────────────────
ensure_config() {
  mkdir -p "${CONFIG_DIR}"
  if [[ -f "${CONFIG_FILE}" && -z "${FORCE}" ]]; then
    ok "Config already exists: ${CONFIG_FILE}"
  else
    if [[ -f "${EXAMPLE_SETTINGS}" ]]; then
      cp "${EXAMPLE_SETTINGS}" "${CONFIG_FILE}"
      ok "Created config: ${CONFIG_FILE}"
      warn "Edit ${CONFIG_FILE} and set CODEGURU_AUTH_TOKEN"
    else
      warn "No example settings found, skipping config creation"
    fi
  fi
}

# ── Cache dir ─────────────────────────────────────────────────────────────────
ensure_cache_dir() {
  mkdir -p "${CACHE_DIR}"
  ok "Cache directory: ${CACHE_DIR}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  local distro
  distro="$(detect_distro)"

  echo ""
  info "CodeGuru Installer (Linux)"
  info "Mode: ${INSTALL_MODE}"
  info "Distro: ${distro}"
  info "Repo:   ${REPO_ROOT}"
  echo ""

  # Verify run from repo root
  if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
    die "package.json not found. Run this script from the CodeGuru repo root."
  fi

  # Node.js
  if ! check_node; then
    if [[ -n "${SKIP_DEPS}" ]]; then
      die "Node.js 18+ required. Install it and re-run, or unset SKIP_DEPS."
    fi
    install_nodejs_fnm
  fi

  # Bun
  if ! check_bun; then
    if [[ -n "${SKIP_DEPS}" ]]; then
      die "Bun required. Install it and re-run, or unset SKIP_DEPS."
    fi
    install_bun
  fi

  # Build
  build_codeguru

  # Install binary
  install_binary

  # Config
  ensure_config
  ensure_cache_dir

  echo ""
  ok "Installation complete!"
  echo ""
  info "Next steps:"
  info "  1. Add ${USER_BIN_DIR} to your PATH if needed"
  info "  2. Edit ${CONFIG_FILE} and set CODEGURU_AUTH_TOKEN"
  info "  3. Run: codeguru"
  echo ""
  info "To uninstall:"
  info "  rm ${USER_BIN_DIR}/${BIN_NAME}"
  info "  rm -rf ${CONFIG_DIR}"
  info "  rm -rf ${CACHE_DIR}"
}

main "$@"