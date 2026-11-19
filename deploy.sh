#!/usr/bin/env bash
# Deploy order-qr-api lên server chạy Node bằng systemd.
#
#   ./deploy.sh                 # cài deps, build, tạo service (lần đầu) hoặc restart
#   SKIP_PULL=1 ./deploy.sh     # không git pull
#
# Biến môi trường tuỳ chỉnh (có mặc định):
#   SERVICE_NAME  tên service systemd          (mặc định: order-qr-api)
#   APP_DIR       thư mục mã nguồn             (mặc định: thư mục chứa script)
#   APP_USER      user chạy service            (mặc định: user gọi script / SUDO_USER)
#   NODE_BIN      đường dẫn node               (mặc định: `command -v node`)
#   GIT_BRANCH    nhánh để pull                (mặc định: nhánh hiện tại)
#   SKIP_PULL=1   bỏ qua git pull
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-order-qr-api}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
APP_USER="${APP_USER:-${SUDO_USER:-$(id -un)}}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] LỖI:\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "dừng ở dòng $LINENO"' ERR

SUDO=""
[[ $EUID -ne 0 ]] && SUDO="sudo"

[[ -n "$NODE_BIN" ]] || die "không tìm thấy node (đặt NODE_BIN=/đường/dẫn/node)"
command -v npm >/dev/null || die "không tìm thấy npm"
command -v systemctl >/dev/null || die "server không có systemd"
cd "$APP_DIR"
[[ -f package.json ]] || die "$APP_DIR không phải thư mục dự án"
[[ -f .env ]] || die "thiếu $APP_DIR/.env (copy từ .env.example rồi điền giá trị)"

# 1. Lấy code mới
if [[ "${SKIP_PULL:-0}" != "1" && -d .git ]]; then
  branch="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
  log "git pull origin $branch"
  git fetch --quiet origin "$branch"
  git checkout --quiet "$branch"
  git pull --ff-only --quiet origin "$branch"
fi

# 2. Cài dependencies (gồm devDependencies vì build cần tsc)
log "npm ci"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund --include=dev
else
  npm install --no-audit --no-fund --include=dev
fi

# 3. Build
log "npm run build"
rm -rf dist
npm run build
[[ -f dist/server.js ]] || die "build xong nhưng không có dist/server.js"

# 4. Lần đầu: tạo service systemd; các lần sau: restart
if [[ ! -f "$UNIT_FILE" ]]; then
  log "tạo service $UNIT_FILE (lần đầu)"
  $SUDO tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=order-qr-api (Express API)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${APP_DIR}/dist/server.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$SERVICE_NAME"
else
  log "restart service $SERVICE_NAME"
  $SUDO systemctl daemon-reload
  $SUDO systemctl restart "$SERVICE_NAME"
fi

# 5. Kiểm tra service còn chạy sau vài giây
sleep 3
if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  log "OK — $SERVICE_NAME đang chạy. Xem log: journalctl -u $SERVICE_NAME -f"
else
  $SUDO journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true
  die "$SERVICE_NAME không chạy sau khi deploy"
fi
