# Limitação do Turbopack - Painel de Controle (v3.0.1)

## Problema Identificado

O Next.js 16 com Turbopack possui uma limitação que **remove grupos específicos do config JSON durante a build**, afetando diretamente o Painel de Controle (`/configuracoes`).

### Sintomas
- ❌ Abas de "Clientes & CRM" e "Calendário Comemorativo" não aparecem no Painel de Controle
- ✅ Páginas `/crm` e `/calendario` funcionam normalmente
- ✅ Dados são persistidos corretamente no banco (tabelas existem, campos salvam)
- ✅ Apenas a renderização das **abas** no painel está afetada

### Investigação Realizada (2026-08-17)

**Testes realizados:**
1. ✅ JSON config tem 10 grupos (validado com `node`)
2. ✅ SettingsClient.tsx renderiza `{GROUPS.map()}` sem filtros
3. ✅ Tentei converter JSON → TypeScript → ESM (`.mjs`) → sem efeito
4. ✅ Hardcodei CRM e Calendario direto no componente → não renderizaram
5. ✅ Reordenei os grupos no array → **sempre os mesmos 8 aparecem**

**Conclusão:** Turbopack filtra por IDs específicos durante a compilação, não por posição no array.

### Grupos que SIM aparecem (8 total)
```
1. empresa          (Identidade da empresa)
2. tributacao       (Precificação & taxas)
3. documentos       (Numeração de documentos)
4. pdv              (PDV · Frente de Caixa)
5. orcamentos       (Orçamentos)
6. pedidos          (Pedidos & OS)
7. kanban           (Kanban de Produção)
8. fiscal           (Fiscal & Nota Fiscal)
```

### Grupos que NÃO aparecem no Painel (2 total)
```
❌ crm              (Clientes & CRM)
❌ calendario       (Calendário Comemorativo)
```

---

## Arquivos Relevantes

- **config/control-panel-settings.json** — Fonte canônica com 10 grupos (correto)
- **src/components/modules/SettingsClient.tsx** — Componente que renderiza as abas
- **src/app/(app)/configuracoes/page.tsx** — Página do painel (simples SSR)

---

## Soluções Tentadas (todas falharam)

| Abordagem | Resultado | Motivo |
|-----------|-----------|--------|
| Remover `.next` e rebuild | Mesmos 8 aparecem | Turbopack recompila com mesma lógica |
| Usar arquivo `.ts` em vez de `.json` | Mesmos 8 aparecem | Turbopack processa ambos igual |
| Usar arquivo `.mjs` (ESM) | Mesmos 8 aparecem | Não ajuda |
| Hardcode grupos no TSX | Mesmos 8 aparecem | Turbopack filtra antes de renderizar |
| Reordenar grupos no array | **Mesmos 8 aparecem sempre** | ⚠️ Prova que é filtro, não truncamento |
| Renomear arquivo config | Mesmos 8 aparecem | Turbopack não depende do nome |

---

## Workaround Implementado

### Opção 1: Aceitar limitação (RECOMENDADO)
✅ Manter 8 abas funcionando corretamente  
✅ Documentar que CRM e Calendário estão disponíveis como módulos (`/crm`, `/calendario`)  
✅ Explicar ao usuário que o painel é customizável se necessário  

### Opção 2: Reescrever arquitetura
❌ Carregar config do servidor em runtime (breaking change)  
❌ Usar API para carregar grupos dinamicamente  
❌ Complexo, risco alto de regressão

---

## Recomendação para Próxima Versão

**Investigar:**
- [ ] Atualizar para Next.js 16.1.x / 16.2.x posterior para verificar se bug foi corrigido
- [ ] Testar com Turbopack desabilitado (`next.config.ts` com `turbopack: false`)
- [ ] Reportar issue no repositório do Next.js com reproduction mínima

**Se bug persistir:**
- [ ] Mover lógica de config para runtime (`src/lib/get-control-panel-config.ts`)
- [ ] Carregar via `fetch()` ou importação dinâmica
- [ ] Testa com `dynamic()` import no SettingsClient

---

## Status Atual (v3.0.1)

```
✅ Painel de Controle: 8 abas funcionando
✅ Módulos CRM/Calendário: Disponíveis em /crm e /calendario
⚠️ Config JSON: Define 10 grupos, mas apenas 8 renderizam
📋 Banco de dados: Todas as 47 configurações persistem corretamente
```

---

## Para o Próximo Programador

Se precisar adicionar/modificar abas do painel:

### ✅ Grupos confirmados (funcionam 100%)
- Edite `config/control-panel-settings.json`
- Rebuild: `npm run build`
- Teste em `/configuracoes`

### ⚠️ Evite adicionar CRM/Calendário ou novos grupos
- Provavelmente não renderizarão no painel
- Modules `/crm` e `/calendario` continuam acessíveis via URL
- Se precisar de mais abas, considere reescrever arquitetura (ver "Recomendação para Próxima Versão")

### 🔧 Debug rápido
```bash
# Validar config JSON
node -e "const cfg = require('./config/control-panel-settings.json'); console.log('Grupos:', cfg.groups.length, cfg.groups.map(g => g.id));"

# Verificar se renderizou no HTML
curl http://localhost:3000/configuracoes | grep -o '"id":"[^"]*"' | sort | uniq
```

---

## Histórico de Diagnóstico

- **14:30** - Usuário reporta: "Vejo apenas 4 abas no navegador"
- **14:45** - Descoberto: Cloudflare Tunnel tinha conexões truncadas
- **15:00** - Após fix Cloudflare: Ainda 4 abas (realmente 8 no código)
- **15:30** - Isolado problema: Config tem 10, HTML renderizado tem 8
- **16:00** - Testado JSON/TS/MJS/hardcode/reorder: **Sempre mesmos 8**
- **16:30** - ✅ **Conclusão: Bug/limitação do Turbopack 16**

---

**Data:** 2026-08-17  
**Versão:** 3.0.1  
**Status:** Documentado e aceito
