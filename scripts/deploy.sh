#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/greenkeeper-backend

target_commit="${1:?Missing deployment commit}"

if [[ ! "$target_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid deployment commit"
  exit 1
fi

# 串行部署，避免两次发布同时修改服务器。
exec 9>/home/ubuntu/.greenkeeper-deploy.lock
flock -w 600 9

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Server checkout must be on main"
  exit 1
fi

# 服务器有已跟踪文件的本地修改时停止，避免覆盖。
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Server has local tracked changes; deployment stopped"
  exit 1
fi

export GIT_TERMINAL_PROMPT=0
git fetch origin main

# 只部署当前 main 最新提交，忽略已被更新提交取代的任务。
if [[ "$(git rev-parse origin/main)" != "$target_commit" ]]; then
  echo "A newer main commit exists; skipping this deployment"
  exit 0
fi

git merge-base --is-ancestor HEAD "$target_commit"

# 检查需要的 sudo 权限，不执行重启。
sudo -n -l /usr/bin/systemctl restart greenkeeper.service >/dev/null

# 使用当前应用配置定位数据库，并创建一致性备份。
# better-sqlite3 的 backup API 可用于运行中的 SQLite。
node <<'NODE'
require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function backup() {
  const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || './data');
  const databasePath = path.join(dataDirectory, 'greenkeeper.sqlite');

  if (!fs.existsSync(databasePath)) {
    throw new Error('Database missing; check DATA_DIRECTORY before deployment');
  }

  const backupDirectory = '/home/ubuntu/greenkeeper-backups';
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupDirectory, `${timestamp}.sqlite`);
  const db = new Database(databasePath, { readonly: true });

  try {
    await db.backup(destination);
    fs.chmodSync(destination, 0o600);
    console.log('Database backup completed');
  } finally {
    db.close();
  }
}

backup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE

git merge --ff-only "$target_commit"
npm ci --omit=dev

sudo -n /usr/bin/systemctl restart greenkeeper.service

for attempt in {1..20}; do
  if systemctl is-active --quiet greenkeeper.service &&
    curl --fail --silent --max-time 3 \
      http://127.0.0.1:8080/health > /dev/null; then
    echo "Deployment successful: $target_commit"
    exit 0
  fi

  sleep 2
done

echo "Health check failed. Inspect greenkeeper.service on the server."
exit 1
