# 📋 Procedimento Padrão de Update — PrintFlow ERP v3.0.0

## ✅ Checklist Completo para Novo Update

### **FASE 1: Preparação (Antes do Update)**

- [ ] Novo arquivo compactado (ZIP/TAR) disponível
- [ ] Backup externo do PostgreSQL (segurança extra)
- [ ] Documentação lida (INSTALL.md ou UPDATE.md)
- [ ] Versão anotada (ex: 3.0.0 → 3.1.0)

### **FASE 2: Instalação/Update**

```bash
cd /www/wwwroot/erp-grafica

# 1. Extrair novo código (se em ZIP)
unzip novo-codigo-v3.1.0.zip

# 2. Ler documentação
cat docs/UPDATE.md
# ou
cat docs/INSTALL.md

# 3. Executar update automático
bash scripts/update.sh

# 4. Reiniciar servidor
bash scripts/start.sh

# 5. Verificar saúde
curl http://127.0.0.1:3000/api/health
```

### **FASE 3: Limpeza (⚠️ CRÍTICO!)**

```bash
# ✅ SEMPRE rodar após update
bash scripts/cleanup.sh

# Verificar arquivos compactados foram deletados
ls -lh *.zip *.tar* *.tgz 2>/dev/null || echo "✅ Limpo!"

# Ver novo espaço em disco
du -sh /www/wwwroot/erp-grafica
```

### **FASE 4: Git & GitHub**

```bash
# Se houver mudanças
git add -A
git commit -m "update: v3.0.0 → v3.1.0

- Nova feature X
- Fix no bug Y
- Banco sincronizado

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

git push origin main
```

### **FASE 5: Validação**

- [ ] `curl /api/health` → 200 OK
- [ ] Todas as 14 páginas carregando
- [ ] Banco de dados sincronizado
- [ ] Arquivo ZIP deletado
- [ ] Commit no GitHub
- [ ] Push realizado

---

## 🚀 Comando Rápido (Tudo de uma vez)

```bash
cd /www/wwwroot/erp-grafica && \
  bash scripts/update.sh && \
  bash scripts/start.sh && \
  sleep 10 && \
  curl http://127.0.0.1:3000/api/health && \
  bash scripts/cleanup.sh && \
  git push origin main
```

---

## ⚠️ Limpeza Obrigatória

**NÃO ESQUECER:**

```bash
bash scripts/cleanup.sh
```

Arquivos compactados ocupam 500MB+. Sempre deletar para economizar espaço no servidor.

---

## 🔄 Rollback (Se algo der errado)

```bash
# Restaurar backup (se existir em .printflow/backups/)
tar -xzf .printflow/backups/<timestamp>/app-source.tgz -C /tmp/restore
# restaurar arquivos necessários manualmente

# Ou restaurar banco de dados
pg_restore --clean -d "$DATABASE_URL" .printflow/backups/<timestamp>/database.dump

# Rebuild
bash scripts/update.sh
bash scripts/start.sh
```

---

## 📖 Mais Informações

- Guia completo: `docs/UPDATE.md`
- Estrutura: `docs/INSTALL.md`
- Changelog: `docs/CHANGELOG.md`
- Limpeza: `docs/CLEANUP.md`
