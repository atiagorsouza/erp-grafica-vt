# Limpeza de Arquivos Compactados — PrintFlow ERP

## ⚠️ IMPORTANTE

Após cada instalação (`install.sh`) ou update (`update.sh`), **SEMPRE** deletar arquivos compactados/temporários:

```bash
cd /www/wwwroot/erp-grafica

# Deletar arquivos ZIP/compactados
rm -f *.zip
rm -f *.tar.gz
rm -f *.tgz
rm -f debug-and-deploy-erp-system.zip

# Deletar pasta temporária se existir
rm -rf /tmp/erp-grafica-vt
rm -rf /tmp/erp-v*
rm -rf /tmp/backup-*
```

## Automatização

O script `cleanup.sh` faz isso automaticamente após update:

```bash
bash scripts/cleanup.sh
```

## Checklist Pós-Instalação/Update

- [ ] `bash scripts/install.sh` ou `bash scripts/update.sh` ✅
- [ ] `bash scripts/cleanup.sh` (limpar compactados) ✅
- [ ] `bash scripts/start.sh` (reiniciar servidor) ✅
- [ ] Verificar saúde: `curl /api/health` ✅
- [ ] Commit + push (se houver mudanças) ✅

## Limpeza Manual

Se precisar fazer limpeza manual:

```bash
cd /www/wwwroot/erp-grafica

# Listar arquivos a deletar
find . -maxdepth 1 -type f \( -name "*.zip" -o -name "*.tar*" -o -name "*.tgz" \)

# Deletar tudo
find . -maxdepth 1 -type f \( -name "*.zip" -o -name "*.tar*" -o -name "*.tgz" \) -delete
```

## Espaço em Disco

Arquivos compactados podem ocupar 500MB+. Sempre deletar para economizar espaço:

```bash
# Ver espaço atual
du -sh /www/wwwroot/erp-grafica

# Após limpeza
du -sh /www/wwwroot/erp-grafica
```
