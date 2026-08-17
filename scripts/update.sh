#!/usr/bin/env bash
# =============================================================================
# PrintFlow ERP · Atualização de versão
# - Faz backup do estado atual
# - Instala deps, aplica schema e rebuild
# - NÃO reexecuta seed (preserva dados de produção)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo "0.0.0")"
APP_NAME="PrintFlow ERP"
BACKUP_ROOT="${BACKUP_DIR:-$ROOT_DIR/.printflow/backups}"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"

c_info()  { printf '\033[1;36m→\033[0m %s\n' "$*"; }
c_ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
c_warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
c_err()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }
die()     { c_err "$*"; exit 1; }

banner() {
  cat <<EOF

╔══════════════════════════════════════════════════╗
║   ${APP_NAME}  ·  Update → v${VERSION}           
║   Atualização segura (sem reseed)                
╚══════════════════════════════════════════════════╝

EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Comando obrigatório não encontrado: $1"
}

load_env() {
  [[ -f .env ]] || die ".env não encontrado — execute a instalação primeiro (scripts/install.sh)"
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL não definido no .env"
}

previous_version() {
  if [[ -f .printflow/install.json ]]; then
    node -e 'const fs=require("fs"); try{const j=JSON.parse(fs.readFileSync(".printflow/install.json","utf8")); process.stdout.write(j.version||"unknown")}catch{process.stdout.write("unknown")}'
  else
    printf 'unknown'
  fi
}

backup_state() {
  local from_v backup_dir
  from_v="$(previous_version)"
  backup_dir="${BACKUP_ROOT}/${STAMP}_v${from_v}_to_v${VERSION}"
  mkdir -p "$backup_dir"

  c_info "Backup em ${backup_dir}"

  # Snapshot de arquivos críticos (sem node_modules / .next)
  tar --exclude='./node_modules' \
      --exclude='./.next' \
      --exclude='./.printflow/backups' \
      --exclude='./.git' \
      -czf "${backup_dir}/app-source.tgz" \
      . 2>/dev/null || tar -czf "${backup_dir}/app-source.tgz" \
        package.json package-lock.json VERSION src scripts drizzle.config.json \
        next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs .env.example 2>/dev/null || true

  # Dump do banco (se pg_dump disponível)
  if command -v pg_dump >/dev/null 2>&1; then
    c_info "Exportando banco com pg_dump..."
    if pg_dump "$DATABASE_URL" --no-owner --no-acl -F c -f "${backup_dir}/database.dump" 2>/dev/null; then
      c_ok "Dump do banco salvo"
    else
      c_warn "pg_dump falhou — backup do banco ignorado"
    fi
  else
    c_warn "pg_dump não encontrado — backup do banco ignorado"
  fi

  printf '%s\n' "$backup_dir" > .printflow/last-backup.path
  c_ok "Backup concluído"
}

install_deps() {
  c_info "Atualizando dependências..."
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  c_ok "Dependências atualizadas"
}

migrate_schema() {
  c_info "Aplicando mudanças de schema (drizzle-kit push)..."
  npx drizzle-kit push
  c_ok "Schema sincronizado"

  c_info "Garantindo configurações novas sem sobrescrever produção..."
  node scripts/ensure-settings.mjs
  node scripts/sync-document-counters.mjs
  c_ok "Configurações e contadores atualizados"
}

rebuild() {
  c_info "Rebuild de produção..."
  rm -rf .next
  npm run build
  c_ok "Build atualizado"
}

write_meta() {
  mkdir -p .printflow
  local prev
  prev="$(previous_version)"
  cat > .printflow/install.json <<EOF
{
  "version": "${VERSION}",
  "previousVersion": "${prev}",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "installedAt": "$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(".printflow/install.json","utf8"));process.stdout.write(j.installedAt||"")}catch{process.stdout.write("")}' 2>/dev/null || true)",
  "node": "$(node -v)",
  "npm": "$(npm -v)"
}
EOF
  # Garante installedAt se estava vazio
  node -e '
    const fs=require("fs");
    const p=".printflow/install.json";
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    if(!j.installedAt) j.installedAt=j.updatedAt;
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
  '
  c_ok "Versão registrada: v${VERSION}"
}

print_done() {
  cat <<EOF

Atualização concluída: ${APP_NAME} → v${VERSION}

Reinicie o processo de produção:
  bash scripts/start.sh
  # ou via PM2/systemd/Docker conforme seu ambiente

Healthcheck:
  curl -s http://127.0.0.1:\${PORT:-3000}/api/health

Último backup:
  $(cat .printflow/last-backup.path 2>/dev/null || echo "(não registrado)")

EOF
}

main() {
  banner
  need_cmd node
  need_cmd npm
  load_env
  mkdir -p .printflow
  backup_state
  install_deps
  migrate_schema
  rebuild
  write_meta
  print_done
}

main "$@"
