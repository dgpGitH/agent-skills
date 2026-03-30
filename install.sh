#!/usr/bin/env bash
# AgentSkills one-line installer (Linux + macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/chrlsio/agent-skills/main/install.sh | bash
#
# Environment variables:
#   VERSION     - Install a specific version (e.g. "0.1.5" or "v0.1.5"), default: latest
#   DRY_RUN     - Set to "1" to print commands without executing

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO="chrlsio/agent-skills"
APP_NAME="AgentSkills"
GITHUB_RELEASES_API="https://api.github.com/repos/${REPO}/releases"
SCRIPT_VERSION="2.0.0"

PLATFORM=""
ARCH_LABEL=""
DEB_ARCH=""
RPM_ARCH=""
PKG_MANAGER=""
PKG_EXT=""
RELEASE_VERSION=""
ASSET_NAME=""
ASSET_URL=""
TEMP_DIR=""
DOWNLOAD_PATH=""

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fatal() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo -e "${YELLOW}[DRY-RUN]${NC} $*"
  else
    "$@"
  fi
}

show_help() {
  cat <<EOF
${APP_NAME} install script

Usage:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash

Environment variables:
  VERSION   Install specific version tag (e.g. 0.1.5 or v0.1.5), default: latest
  DRY_RUN   Set to 1 to print commands without executing

Examples:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | VERSION=0.1.5 bash
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | DRY_RUN=1 bash
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fatal "Missing required command: $1"
}

normalize_version() {
  local v="$1"
  v="${v#v}"
  printf '%s' "$v"
}

build_curl_args() {
  CURL_ARGS=(
    -fsSL
    -H "Accept: application/vnd.github+json"
    -H "User-Agent: agentskills-installer"
  )
}

github_api_get() {
  local url="$1"
  curl "${CURL_ARGS[@]}" "$url"
}

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux) PLATFORM="linux" ;;
    Darwin) PLATFORM="macos" ;;
    *) fatal "Unsupported OS: $os (use install.ps1 on Windows)." ;;
  esac

  case "$arch" in
    x86_64|amd64)
      ARCH_LABEL="x86_64"
      DEB_ARCH="amd64"
      RPM_ARCH="x86_64"
      ;;
    aarch64|arm64)
      ARCH_LABEL="aarch64"
      DEB_ARCH="arm64"
      RPM_ARCH="aarch64"
      ;;
    *)
      fatal "Unsupported architecture: $arch"
      ;;
  esac

  info "Detected platform: ${PLATFORM} (${ARCH_LABEL})"
}

detect_linux_package_manager() {
  if [[ "$PLATFORM" != "linux" ]]; then
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
    PKG_EXT="deb"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
    PKG_EXT="rpm"
  elif command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
    PKG_EXT="rpm"
  else
    PKG_MANAGER="appimage"
    PKG_EXT="AppImage"
    warn "No apt/dnf/yum found, falling back to AppImage."
  fi

  info "Linux installer preference: ${PKG_MANAGER} (${PKG_EXT})"
}

parse_tag_from_json() {
  grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

extract_assets_from_json() {
  sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | while IFS= read -r url; do
    [ -z "$url" ] && continue
    name="${url##*/}"
    printf '%s\t%s\n' "$name" "$url"
  done
}

build_fallback_assets() {
  local base_url="https://github.com/${REPO}/releases/download/v${RELEASE_VERSION}"
  cat <<EOF
AgentSkills_${RELEASE_VERSION}_aarch64.dmg	${base_url}/AgentSkills_${RELEASE_VERSION}_aarch64.dmg
AgentSkills_${RELEASE_VERSION}_x64.dmg	${base_url}/AgentSkills_${RELEASE_VERSION}_x64.dmg
AgentSkills_${RELEASE_VERSION}_amd64.deb	${base_url}/AgentSkills_${RELEASE_VERSION}_amd64.deb
AgentSkills_${RELEASE_VERSION}_arm64.deb	${base_url}/AgentSkills_${RELEASE_VERSION}_arm64.deb
AgentSkills-${RELEASE_VERSION}-1.x86_64.rpm	${base_url}/AgentSkills-${RELEASE_VERSION}-1.x86_64.rpm
AgentSkills-${RELEASE_VERSION}-1.aarch64.rpm	${base_url}/AgentSkills-${RELEASE_VERSION}-1.aarch64.rpm
AgentSkills_${RELEASE_VERSION}_amd64.AppImage	${base_url}/AgentSkills_${RELEASE_VERSION}_amd64.AppImage
AgentSkills_${RELEASE_VERSION}_aarch64.AppImage	${base_url}/AgentSkills_${RELEASE_VERSION}_aarch64.AppImage
EOF
}

get_release_version() {
  if [[ -n "${VERSION:-}" ]]; then
    RELEASE_VERSION="$(normalize_version "$VERSION")"
    info "Using specified version: v${RELEASE_VERSION}"
    return 0
  fi

  info "Fetching latest release version..."

  local latest_json latest_tag
  if latest_json="$(github_api_get "${GITHUB_RELEASES_API}/latest" 2>/dev/null)"; then
    latest_tag="$(printf '%s' "$latest_json" | parse_tag_from_json)"
    latest_tag="${latest_tag#v}"
    if [[ -n "$latest_tag" ]]; then
      RELEASE_VERSION="$latest_tag"
      info "Latest version: v${RELEASE_VERSION}"
      return 0
    fi
  fi

  warn "GitHub API unavailable or rate-limited. Trying redirect fallback..."
  local redirect
  redirect="$(curl -fsSI "https://github.com/${REPO}/releases/latest" | awk 'tolower($1)=="location:" {print $2}' | tr -d '\r' | sed -n '1p')"
  RELEASE_VERSION="$(printf '%s' "$redirect" | sed -E 's|.*/tag/v||')"
  [[ -z "$RELEASE_VERSION" ]] && fatal "Unable to determine latest version. Set VERSION explicitly."

  info "Latest version: v${RELEASE_VERSION}"
}

fetch_assets() {
  local release_json
  local api_url="${GITHUB_RELEASES_API}/tags/v${RELEASE_VERSION}"

  info "Fetching release metadata for v${RELEASE_VERSION}..."
  if release_json="$(github_api_get "$api_url" 2>/dev/null)"; then
    ASSETS="$(printf '%s' "$release_json" | extract_assets_from_json)"
  fi

  if [[ -z "${ASSETS:-}" ]]; then
    warn "GitHub API metadata unavailable. Falling back to conventional asset names."
    ASSETS="$(build_fallback_assets)"
  fi
}

select_asset_from_candidates() {
  local candidates="$1"
  local first_line
  first_line="$(printf '%s\n' "$candidates" | sed -n '1p')"
  [[ -z "$first_line" ]] && return 1
  ASSET_NAME="$(printf '%s' "$first_line" | awk -F'\t' '{print $1}')"
  ASSET_URL="$(printf '%s' "$first_line" | awk -F'\t' '{print $2}')"
  return 0
}

choose_asset() {
  local candidates=""

  if [[ "$PLATFORM" == "macos" ]]; then
    candidates="$(printf '%s\n' "$ASSETS" | grep -E -i '\.dmg$' || true)"
    if [[ "$ARCH_LABEL" == "aarch64" ]]; then
      candidates="$(printf '%s\n' "$candidates" | grep -E -i 'arm64|aarch64' || true)"
    else
      candidates="$(printf '%s\n' "$candidates" | grep -E -i 'x64|x86_64|amd64|intel' || true)"
    fi
    select_asset_from_candidates "$candidates" || fatal "Failed to select macOS asset for ${ARCH_LABEL}."
    info "Selected asset: ${ASSET_NAME}"
    return 0
  fi

  case "$PKG_EXT" in
    deb)
      candidates="$(printf '%s\n' "$ASSETS" | grep -E -i "\.deb$" | grep -E -i "${DEB_ARCH}|${ARCH_LABEL}" || true)"
      ;;
    rpm)
      candidates="$(printf '%s\n' "$ASSETS" | grep -E -i "\.rpm$" | grep -E -i "${RPM_ARCH}|${ARCH_LABEL}" || true)"
      ;;
    AppImage)
      if [[ "$ARCH_LABEL" == "aarch64" ]]; then
        candidates="$(printf '%s\n' "$ASSETS" | grep -E -i "\.AppImage$" | grep -E -i 'aarch64|arm64' || true)"
      else
        candidates="$(printf '%s\n' "$ASSETS" | grep -E -i "\.AppImage$" | grep -E -i 'amd64|x86_64|x64' || true)"
      fi
      ;;
  esac

  if ! select_asset_from_candidates "$candidates"; then
    warn "Preferred format (${PKG_EXT}) not found, trying fallback formats."
    candidates="$(printf '%s\n' "$ASSETS" | grep -E -i "\.deb$|\.rpm$|\.AppImage$" | grep -E -i "${DEB_ARCH}|${RPM_ARCH}|${ARCH_LABEL}|arm64|aarch64|amd64|x86_64|x64" || true)"
    select_asset_from_candidates "$candidates" || fatal "Failed to select Linux asset for ${ARCH_LABEL}."
  fi

  info "Selected asset: ${ASSET_NAME}"
}

download_asset() {
  TEMP_DIR="$(mktemp -d)"
  DOWNLOAD_PATH="${TEMP_DIR}/${ASSET_NAME}"

  info "Downloading ${ASSET_NAME}..."
  run curl -fSL --progress-bar -o "$DOWNLOAD_PATH" "$ASSET_URL"
  [[ "${DRY_RUN:-0}" == "1" ]] || [[ -f "$DOWNLOAD_PATH" ]] || fatal "Download failed."
}

install_linux() {
  info "Installing ${APP_NAME} on Linux..."
  case "$ASSET_NAME" in
    *.deb)
      run sudo dpkg -i "$DOWNLOAD_PATH"
      run sudo apt-get install -f -y
      ;;
    *.rpm)
      if [[ "$PKG_MANAGER" == "dnf" ]]; then
        run sudo dnf install -y "$DOWNLOAD_PATH"
      elif [[ "$PKG_MANAGER" == "yum" ]]; then
        run sudo yum install -y "$DOWNLOAD_PATH"
      else
        run sudo rpm -i "$DOWNLOAD_PATH"
      fi
      ;;
    *.AppImage)
      local target_dir="${HOME}/.local/bin"
      local target_path="${target_dir}/agentskills.AppImage"
      run mkdir -p "$target_dir"
      run cp "$DOWNLOAD_PATH" "$target_path"
      run chmod +x "$target_path"
      warn "AppImage installed at ${target_path}"
      ;;
    *)
      fatal "Unsupported Linux package: ${ASSET_NAME}"
      ;;
  esac
}

install_macos() {
  info "Installing ${APP_NAME} on macOS..."
  [[ "$ASSET_NAME" == *.dmg ]] || fatal "Expected a .dmg for macOS, got: ${ASSET_NAME}"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo -e "${YELLOW}[DRY-RUN]${NC} hdiutil attach \"$DOWNLOAD_PATH\" -nobrowse -noautoopen"
    echo -e "${YELLOW}[DRY-RUN]${NC} cp -R <mounted>/*.app /Applications/"
    echo -e "${YELLOW}[DRY-RUN]${NC} hdiutil detach <mounted>"
    echo -e "${YELLOW}[DRY-RUN]${NC} sudo xattr -rd com.apple.quarantine \"/Applications/${APP_NAME}.app\""
    return 0
  fi

  local mount_output mount_point app_path
  mount_output="$(hdiutil attach "$DOWNLOAD_PATH" -nobrowse -noautoopen 2>&1)" || fatal "Failed to mount dmg: $mount_output"
  mount_point="$(printf '%s\n' "$mount_output" | awk 'END {print $NF}')"
  [[ -d "$mount_point" ]] || fatal "Invalid mount point: $mount_point"

  app_path=""
  for maybe_app in "$mount_point"/*.app; do
    if [[ -d "$maybe_app" ]]; then
      app_path="$maybe_app"
      break
    fi
  done
  [[ -n "$app_path" ]] || { hdiutil detach "$mount_point" >/dev/null 2>&1 || true; fatal "No .app found in dmg."; }

  if [[ -d "/Applications/$(basename "$app_path")" ]]; then
    info "Removing existing app from /Applications..."
    rm -rf "/Applications/$(basename "$app_path")"
  fi
  cp -R "$app_path" /Applications/
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true

  info "Removing quarantine attribute..."
  sudo xattr -rd com.apple.quarantine "/Applications/$(basename "$app_path")" >/dev/null 2>&1 || true
}

cleanup() {
  [[ -n "${TEMP_DIR:-}" && -d "${TEMP_DIR}" ]] && rm -rf "$TEMP_DIR"
}

main() {
  for arg in "$@"; do
    case "$arg" in
      -h|--help) show_help; exit 0 ;;
      -v|--version) echo "install.sh v${SCRIPT_VERSION}"; exit 0 ;;
      *) fatal "Unknown argument: $arg" ;;
    esac
  done

  require_cmd curl
  require_cmd mktemp
  require_cmd uname
  build_curl_args

  trap cleanup EXIT

  echo ""
  echo -e "${BLUE}=====================================${NC}"
  echo -e "${BLUE}      ${APP_NAME} Installer${NC}"
  echo -e "${BLUE}=====================================${NC}"
  echo ""

  detect_platform
  detect_linux_package_manager
  get_release_version
  fetch_assets
  choose_asset
  download_asset

  case "$PLATFORM" in
    linux) install_linux ;;
    macos) install_macos ;;
  esac

  echo ""
  success "Installation complete."
  echo ""
}

main "$@"
