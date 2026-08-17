# Changelog — PrintFlow ERP

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).  
Versionamento: [SemVer](https://semver.org/lang/pt-BR/).

---

## [3.0.0] — 2026-08-17

### Base limpa (breaking)

Nova linha de versão a partir de uma base reorganizada para produção.

#### Removido
- Motor completo de **comunicação** (WhatsApp / e-mail)
  - Páginas, APIs, cron, webhooks, lib e tabelas de outbox/inbox/templates/regras/consentimentos
  - Dependência `svix`
  - Itens de menu e seções do Painel de Controle ligados à central de comunicação
- Documentação legada de auditorias, erros e deploys antigos
- Scripts e bundles de deploy antigos
- Seed auxiliar `seed-full.mjs` (consolidado no fluxo oficial)

#### Adicionado
- Versionamento canônico (`VERSION` = `3.0.0`)
- Scripts oficiais de ciclo de vida:
  - `scripts/install.sh` — primeira instalação
  - `scripts/update.sh` — update com backup (sem reseed)
  - `scripts/start.sh` — start de produção
- Seeds oficiais em `scripts/seed.mjs` e `scripts/seed-calendar.mjs`
- Documentação enxuta: `README.md`, `docs/INSTALL.md`, `docs/UPDATE.md`, `docs/CHANGELOG.md`
- `.env.example` e `.gitignore` alinhados à produção
- Exemplo Nginx em `deploy/nginx-printflow.conf`
- Metadados locais em `.printflow/install.json`

#### Mantido
- App Router Next.js + PostgreSQL (Drizzle ORM)
- Módulos: Dashboard, PDV, Orçamentos, Pedidos, Clientes/CRM, Kanban, Calendário, Impressoras, Produtos, Tabelas de preços, Serviços, Estoque, Financeiro, Relatórios, Configurações
- Links manuais de WhatsApp Web nos documentos (sem envio automático)
- Campo de contato WhatsApp em clientes / empresa (cadastro apenas)

### Migração a partir de 2.x

1. Backup completo do banco e do código antigo
2. Substitua o código pela árvore 3.0.0
3. Preserve o `.env` de produção
4. Execute `bash scripts/update.sh`
5. Tabelas antigas de comunicação, se existirem, podem ser dropadas manualmente após validação:

```sql
-- opcional, somente após backup
DROP TABLE IF EXISTS communication_events CASCADE;
DROP TABLE IF EXISTS communication_inbox CASCADE;
DROP TABLE IF EXISTS communication_outbox CASCADE;
DROP TABLE IF EXISTS customer_consents CASCADE;
DROP TABLE IF EXISTS communication_rules CASCADE;
DROP TABLE IF EXISTS message_templates CASCADE;
DROP TABLE IF EXISTS communication_channels CASCADE;
DROP TYPE IF EXISTS communication_status;
DROP TYPE IF EXISTS communication_kind;
DROP TYPE IF EXISTS communication_channel;
```

---

## [2.x] — legado

Histórico anterior arquivado fora deste repositório limpo.  
Use a linha 3.0.0 como ponto zero operacional.
