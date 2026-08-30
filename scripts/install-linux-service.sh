#!/usr/bin/env bash
# Install Hypermania as a hardened systemd service on Linux.
set -Eeuo pipefail

SERVICE_NAME="hypermania"
INSTALL_DIR="/opt/hypermania"
SERVICE_USER="hypermania"
PORT="3000"
OLLAMA_BASE="http://127.0.0.1:11434"
NON_INTERACTIVE=false

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/install-linux-service.sh [options]

Options:
  --install-dir DIR     App location (default: /opt/hypermania)
  --service-user USER   Unprivileged systemd user (default: hypermania)
  --port PORT           Hypermania listen port (default: 3000)
  --ollama-base URL     Ollama API base URL (default: http://127.0.0.1:11434)
  -y, --non-interactive Use defaults and supplied options without prompting
  -h, --help            Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --ollama-base) OLLAMA_BASE="$2"; shift 2 ;;
    -y|--non-interactive) NON_INTERACTIVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root, for example: sudo bash scripts/install-linux-service.sh" >&2
  exit 1
fi

prompt_value() {
  local label="$1"
  local current="$2"
  local reply
  printf '%s [%s]: ' "$label" "$current" >&2
  read -r reply
  printf '%s' "${reply:-$current}"
}

if [[ -t 0 && "$NON_INTERACTIVE" == false ]]; then
  echo "Configure Hypermania (press Enter to keep each default):"
  INSTALL_DIR="$(prompt_value "Install directory" "$INSTALL_DIR")"
  SERVICE_USER="$(prompt_value "Service user" "$SERVICE_USER")"
  PORT="$(prompt_value "Hypermania port" "$PORT")"
  OLLAMA_BASE="$(prompt_value "Ollama API URL" "$OLLAMA_BASE")"
  echo
fi

for command in systemctl tar node; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "Node.js 18 or newer is required (found $(node --version))." >&2
  exit 1
fi

SOURCE_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$SOURCE_DIR/server.js" || ! -d "$SOURCE_DIR/public" ]]; then
  echo "Run this script from an intact Hypermania project checkout." >&2
  exit 1
fi

if [[ "$SOURCE_DIR" == "$INSTALL_DIR" ]]; then
  echo "The source directory and install directory must be different." >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
ENV_DIR="/etc/${SERVICE_NAME}"
ENV_FILE="${ENV_DIR}/${SERVICE_NAME}.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/var/lib/${SERVICE_NAME}" \
    --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o root -g root -m 0755 "$INSTALL_DIR"
tar -C "$SOURCE_DIR" \
  --exclude='./node_modules' \
  --exclude='./.git' \
  --exclude='./*.log' \
  --exclude='./.env' \
  -cf - . | tar -C "$INSTALL_DIR" -xf -
chown -R root:root "$INSTALL_DIR"
touch "$INSTALL_DIR/${SERVICE_NAME}.log"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/${SERVICE_NAME}.log"
chmod 0640 "$INSTALL_DIR/${SERVICE_NAME}.log"

install -d -o root -g "$SERVICE_USER" -m 0750 "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 027
  printf 'PORT=%s\nOLLAMA_BASE=%s\n' "$PORT" "$OLLAMA_BASE" > "$ENV_FILE"
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
else
  echo "Preserving existing configuration at $ENV_FILE"
fi

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Hypermania local Ollama web UI
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo
echo "Hypermania is running as ${SERVICE_NAME}.service"
echo "Configuration: $ENV_FILE"
echo "Logs:          journalctl -u $SERVICE_NAME -f"
echo "App log:       $INSTALL_DIR/${SERVICE_NAME}.log"
echo "Open:          http://localhost:${PORT}"
