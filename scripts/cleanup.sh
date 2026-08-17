#!/usr/bin/env bash
# ==========================================================================
# PrintFlow ERP · Limpeza de Arquivos Compactados
# Usa: bash scripts/cleanup.sh
# 
# Remove arquivos ZIP, TAR e temporários após instalação/update
# ==========================================================================
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

C_OK=$'\033[0;32m'
C_WARN=$'\033[0;33m'
C_INFO=$'\033[0;36m'
C_OFF=$'\033[0m'

step() { echo; echo "${C_INFO}==> $*${C_OFF}"; }
ok()   { echo "${C_OK}  ✓ $*${C_OFF}"; }
warn() { echo "${C_WARN}  ! $*${C_OFF}"; }

echo "╔════════════════════════════════════════╗"
echo "║  PrintFlow ERP · Limpeza de Arquivos  ║"
echo "╚════════════════════════════════════════╝"

step "1. Deletando arquivos ZIP na pasta raiz"
DELETED=0
for file in *.zip *.tar.gz *.tgz *.tar; do
  if [ -f "$file" ]; then
    rm -f "$file"
    ok "Deletado: $file"
    ((DELETED++))
  fi
done
[ $DELETED -eq 0 ] && ok "Nenhum arquivo compactado encontrado"

step "2. Limpando /tmp de arquivos erp antigos"
rm -rf /tmp/erp-grafica-vt 2>/dev/null && ok "Removido /tmp/erp-grafica-vt" || ok "Não encontrado"
rm -rf /tmp/erp-v* 2>/dev/null && ok "Removido /tmp/erp-v*" || ok "Não encontrado"
rm -rf /tmp/backup-* 2>/dev/null && ok "Removido /tmp/backup-*" || ok "Não encontrado"

step "3. Espaço em disco"
SIZE=$(du -sh . | cut -f1)
ok "Tamanho da pasta: $SIZE"

echo
echo "${C_OK}════════════════════════════════════════${C_OFF}"
echo "${C_OK}  ✓ Limpeza concluída com sucesso!${C_OFF}"
echo "${C_OK}════════════════════════════════════════${C_OFF}"
echo
