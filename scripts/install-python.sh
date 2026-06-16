#!/usr/bin/env bash
# Install the Python design-doc tool (section B in SETUP.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv"

info() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

main() {
  info "CodeGuru Python doc tool install"
  cd "${REPO_ROOT}"

  command_exists python3 || die "python3 not found. Install Python 3.10+."

  if ! command_exists pandoc; then
    info "pandoc not found (needed for docx conversion)."
    if [[ "$(uname -s)" == "Darwin" ]] && command_exists brew; then
      info "Installing pandoc via Homebrew..."
      brew install pandoc
    else
      die "Install pandoc: https://pandoc.org/installing.html"
    fi
  fi
  ok "[ok] pandoc $(pandoc --version | head -1)"

  if [[ ! -d "${VENV_DIR}" ]]; then
    info "Creating virtual environment at .venv ..."
    python3 -m venv "${VENV_DIR}"
  fi

  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"
  pip install --upgrade pip
  pip install -r requirements.txt
  pip install -e .

  ok "Python tool installed."
  info "Activate: source .venv/bin/activate"
  info "Run:      guru path/to/design.docx"
}

main "$@"
