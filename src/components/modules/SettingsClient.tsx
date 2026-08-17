"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/mutate";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

type FieldDef = {
  key: string;
  label: string;
  hint?: string;
  type?: "text" | "number" | "select" | "textarea" | "toggle";
  options?: { value: string; label: string }[];
  suffix?: string;
  span2?: boolean;
  mono?: boolean;
};

type Group = {
  id: string;
  title: string;
  desc: string;
  icon: "building" | "calc" | "quote" | "gear" | "receipt" | "kanban" | "orders" | "users" | "calendar" | "mail" | "wallet";
  color: string;
  fields: FieldDef[];
};

const GROUPS: Group[] = [
  /* ── EMPRESA ── */
  {
    id: "empresa",
    title: "Identidade da empresa",
    desc: "Aparece nos orçamentos, cupons, impressão de OS e mensagens automáticas.",
    icon: "building",
    color: "text-proc-c",
    fields: [
      { key: "company_name",         label: "Nome fantasia / Marca" },
      { key: "company_legal_name",   label: "Razão social" },
      { key: "company_cnpj",         label: "CNPJ", mono: true },
      { key: "company_email",        label: "E-mail comercial" },
      { key: "company_phone",        label: "Telefone 1", mono: true },
      { key: "company_phone2",       label: "Telefone 2", mono: true },
      { key: "company_whatsapp",     label: "WhatsApp", mono: true },
      { key: "company_website",      label: "Website" },
      { key: "pix_key",              label: "Chave PIX", span2: true },
      { key: "company_street",       label: "Rua / Logradouro" },
      { key: "company_number",       label: "Número", mono: true },
      { key: "company_district",     label: "Bairro" },
      { key: "company_city",         label: "Cidade" },
      { key: "company_state",        label: "UF", mono: true },
      { key: "company_cep",          label: "CEP", mono: true },
    ],
  },

  /* ── TRIBUTAÇÃO & PREÇOS ── */
  {
    id: "tributacao",
    title: "Precificação & taxas",
    desc: "Parâmetros globais usados pelo motor de preços em todos os cálculos. Alterações valem imediatamente.",
    icon: "calc",
    color: "text-amber-600",
    fields: [
      { key: "tax_rate",            label: "Imposto sobre venda (Simples etc.)", type: "number", suffix: "%", hint: "Embutido no preço final pelo motor" },
      { key: "operational_rate",   label: "Markup operacional (aluguel, folha, energia)", type: "number", suffix: "%" },
      { key: "card_fee_debit",     label: "Taxa maquininha — Débito", type: "number", suffix: "%", mono: true },
      { key: "card_fee_credit",    label: "Taxa maquininha — Crédito", type: "number", suffix: "%", mono: true },
    ],
  },

  /* ── DOCUMENTOS ── */
  {
    id: "documentos",
    title: "Numeração de documentos",
    desc: "Sequências atômicas — nunca colidem entre operadores simultâneos. Cada tipo tem prefixo próprio.",
    icon: "quote",
    color: "text-proc-m",
    fields: [
      { key: "document_number_mode",     label: "Modo de numeração", type: "select", options: [{ value: "annual", label: "Anual (reinicia todo ano)" }, { value: "continuous", label: "Contínuo (nunca reinicia)" }] },
      { key: "document_number_width",    label: "Dígitos do sequencial", type: "number", hint: "Ex.: 4 → ORC-2026-0001" },
      { key: "document_prefix_quote",    label: "Prefixo orçamento", mono: true, hint: "Ex.: ORC" },
      { key: "document_prefix_order",    label: "Prefixo pedido / OS", mono: true, hint: "Ex.: PED" },
      { key: "document_prefix_sale",     label: "Prefixo venda PDV", mono: true, hint: "Ex.: PDV" },
      { key: "document_prefix_purchase", label: "Prefixo compra", mono: true, hint: "Ex.: CMP" },
    ],
  },

  /* ── PDV ── */
  {
    id: "pdv",
    title: "PDV · Frente de Caixa",
    desc: "Padrões do ponto de venda: vendedor padrão, rodapé do cupom, entrega e regras de estoque.",
    icon: "receipt",
    color: "text-emerald-600",
    fields: [
      { key: "pdv_seller_default",       label: "Vendedor / Atendente padrão", hint: "Pré-preenchido no cupom" },
      { key: "pdv_delivery_default",     label: "Situação de entrega padrão", type: "select", options: [{ value: "Entrega direto para o cliente", label: "Entrega direto para o cliente" }, { value: "Retirada no balcão", label: "Retirada no balcão" }, { value: "Envio por Motoboy / Transportadora", label: "Envio por Motoboy / Transportadora" }] },
      { key: "pdv_allow_negative_stock", label: "Permitir venda com estoque negativo?", type: "select", options: [{ value: "false", label: "Não (exige confirmação)" }, { value: "true", label: "Sim (sem bloqueio)" }] },
      { key: "pdv_require_customer",     label: "Exigir cliente identificado?", type: "select", options: [{ value: "false", label: "Não (consumidor final)" }, { value: "true", label: "Sim (obrigatório)" }] },
      { key: "pdv_require_open_cash",    label: "Exigir caixa aberto para vender?", type: "select", options: [{ value: "true", label: "Sim (recomendado em produção)" }, { value: "false", label: "Não (permite vender sem sessão)" }] },
      { key: "pdv_receipt_footer",       label: "Rodapé do cupom térmico", type: "textarea", span2: true, hint: "Aparece no final do cupom impresso e no texto do WhatsApp" },
    ],
  },

  /* ── ORÇAMENTOS ── */
  {
    id: "orcamentos",
    title: "Orçamentos",
    desc: "Padrões para novos orçamentos: validade, vendedor, pagamento e texto de condições.",
    icon: "quote",
    color: "text-proc-c",
    fields: [
      { key: "quote_validity_days",   label: "Validade padrão (dias)", type: "number", hint: "Dias a partir da criação" },
      { key: "quote_default_payment", label: "Forma de pagamento padrão", type: "select", options: [
        { value: "PIX", label: "PIX" },
        { value: "Dinheiro", label: "Dinheiro" },
        { value: "Débito", label: "Débito" },
        { value: "Crédito", label: "Crédito" },
        { value: "Boleto", label: "Boleto" },
        { value: "50% entrada + 50% na entrega", label: "50% entrada + 50% na entrega" },
      ]},
      { key: "quote_default_seller",  label: "Vendedor padrão" },
      { key: "quote_default_notes",   label: "Observações / condições padrão", type: "textarea", span2: true },
    ],
  },

  /* ── PEDIDOS ── */
  {
    id: "pedidos",
    title: "Pedidos & OS",
    desc: "Automações e padrões para ordens de produção — Kanban, entrega e lançamento financeiro.",
    icon: "orders",
    color: "text-proc-m",
    fields: [
      { key: "order_default_priority", label: "Prioridade padrão", type: "select", options: [{ value: "baixa", label: "Baixa" }, { value: "normal", label: "Normal" }, { value: "alta", label: "Alta" }, { value: "urgente", label: "Urgente" }] },
      { key: "order_default_channel",  label: "Canal de entrada padrão", type: "select", options: [
        { value: "Atendimento", label: "Atendimento" },
        { value: "Balcão", label: "Balcão" },
        { value: "WhatsApp", label: "WhatsApp" },
        { value: "Instagram", label: "Instagram" },
        { value: "E-mail", label: "E-mail" },
        { value: "Site", label: "Site" },
      ]},
      { key: "order_auto_kanban",      label: "Criar card Kanban automaticamente?", type: "select", options: [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] },
      { key: "order_auto_delivery",    label: "Criar registro de entrega automaticamente?", type: "select", options: [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] },
      { key: "order_auto_transaction", label: "Lançar no financeiro automaticamente?", type: "select", options: [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] },
    ],
  },

  /* ── KANBAN ── */
  {
    id: "kanban",
    title: "Kanban de Produção",
    desc: "Sincronização entre o status do pedido e a coluna do Kanban — mapeamento automático.",
    icon: "kanban",
    color: "text-proc-c",
    fields: [
      { key: "kanban_auto_sync_orders", label: "Sincronizar automaticamente com Pedidos?", type: "select", options: [{ value: "true", label: "Sim — ao avançar produção, o card se move" }, { value: "false", label: "Não — mover manual" }] },
      { key: "kanban_columns",          label: "Colunas (separadas por vírgula)", hint: "backlog,producao,revisao,pronto,entregue", mono: true },
    ],
  },

  /* ── CLIENTES & CRM ── */
  {
    id: "crm",
    title: "Clientes & CRM",
    desc: "Intervalo de follow-up e expiração de leads inativos.",
    icon: "users",
    color: "text-proc-c",
    fields: [
      { key: "crm_followup_interval_days", label: "Intervalo padrão de follow-up (dias)", type: "number", hint: "Dias entre contatos no pipeline" },
      { key: "crm_lead_expiry_days",       label: "Expiração de leads inativos (dias)", type: "number", hint: "Lead sem contato depois desse prazo vai para Perdido" },
    ],
  },

  /* ── CALENDÁRIO ── */
  {
    id: "calendario",
    title: "Calendário Comemorativo",
    desc: "Alertas antecipados de datas e disparo automático de campanhas sazonais.",
    icon: "calendar",
    color: "text-proc-y",
    fields: [
      { key: "calendar_alert_days_before",   label: "Alertar quantos dias antes da data?", type: "number", hint: "Ex.: 7 = alerta com uma semana de antecedência" },
      { key: "calendar_auto_campaign_alert", label: "Criar alerta automático de campanha?", type: "select", options: [{ value: "true", label: "Sim — notificação no painel" }, { value: "false", label: "Não" }] },
    ],
  },

  /* ── FISCAL ── */
  {
    id: "fiscal",
    title: "Fiscal & Nota Fiscal",
    desc: "Ambiente NF-e / NFC-e e regime tributário. Emissão via integrador externo.",
    icon: "wallet",
    color: "text-ink-500",
    fields: [
      { key: "fiscal_environment",        label: "Ambiente", type: "select", options: [{ value: "homologacao", label: "Homologação (testes)" }, { value: "producao", label: "Produção (real)" }] },
      { key: "fiscal_tax_regime",         label: "Regime tributário", type: "select", options: [{ value: "simples", label: "Simples Nacional" }, { value: "presumido", label: "Lucro Presumido" }, { value: "real", label: "Lucro Real" }, { value: "mei", label: "MEI" }] },
      { key: "fiscal_provider",           label: "Provedor de NF", type: "select", options: [{ value: "manual", label: "Manual (sem integração)" }, { value: "nfeio", label: "NFe.io" }, { value: "focus", label: "Focus NFe" }] },
      { key: "fiscal_nfe_enabled",        label: "NF-e habilitada?", type: "select", options: [{ value: "false", label: "Não" }, { value: "true", label: "Sim" }] },
      { key: "fiscal_nfce_enabled",       label: "NFC-e habilitada?", type: "select", options: [{ value: "false", label: "Não" }, { value: "true", label: "Sim" }] },
      { key: "fiscal_nfse_enabled",       label: "NFS-e habilitada?", type: "select", options: [{ value: "false", label: "Não" }, { value: "true", label: "Sim" }] },
      { key: "fiscal_certificate_type",   label: "Certificado digital", type: "select", options: [{ value: "nenhum", label: "Nenhum" }, { value: "a1", label: "A1 (arquivo PFX)" }, { value: "a3", label: "A3 (token/cartão)" }] },
    ],
  },
];

const categoryOf = (key: string): string => {
  const group = GROUPS.find((g) => g.fields.some((f) => f.key === key));
  return group?.id || "geral";
};

export function SettingsClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const initial: Record<string, string> = {};
  for (const r of rows) initial[String(r.key)] = String(r.value ?? "");
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("empresa");

  const dirty = Object.entries(form).filter(
    ([k, v]) => String(rows.find((r) => String(r.key) === k)?.value ?? "") !== v
  ).length;

  async function save() {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(form)) {
        const existing = rows.find((r) => String(r.key) === key);
        if (existing) {
          if (String(existing.value ?? "") !== value)
            await mutate("settings", "update", { value }, Number(existing.id));
        } else if (value !== "") {
          await mutate("settings", "create", { key, value, category: categoryOf(key) });
        }
      }
      toast.success("Configurações salvas", "O motor já usa os novos parâmetros.");
      router.refresh();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  const group = GROUPS.find((g) => g.id === active)!;

  return (
    <div>
      <PageHeader
        eyebrow="Parâmetros do sistema"
        title="Painel de Controle"
        icon="gear"
        description="Empresa, motor de precificação, PDV, orçamentos, pedidos, Kanban, CRM, calendário e fiscal. Tudo em um lugar, organizado por módulo."
        actions={
          <Button icon="check" onClick={save} loading={saving} disabled={dirty === 0}>
            Salvar alterações{dirty > 0 ? ` · ${dirty}` : ""}
          </Button>
        }
      />

      <div className="reveal grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* ── MENU LATERAL ── */}
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:pb-0">
          {GROUPS.map((g) => {
            const changedCount = g.fields.filter((f) => {
              const orig = String(rows.find((r) => String(r.key) === f.key)?.value ?? "");
              return form[f.key] !== undefined && form[f.key] !== orig;
            }).length;
            return (
              <button
                key={g.id}
                onClick={() => setActive(g.id)}
                className={cn(
                  "focus-ring flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-all",
                  active === g.id
                    ? "border-ink-900 bg-ink-900 text-white shadow-pop"
                    : "border-paper-200 bg-paper-50 text-ink-600 hover:border-ink-300"
                )}
              >
                <Icon
                  name={g.icon}
                  size={15}
                  className={active === g.id ? "text-cyan-300" : `${g.color} opacity-70`}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{g.title}</span>
                {changedCount > 0 && (
                  <Badge tone="amber" className="shrink-0">{changedCount}</Badge>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── FORMULÁRIO DO GRUPO ATIVO ── */}
        <Card className="reveal reveal-1">
          <div className="mb-5 border-b border-dashed border-paper-300 pb-4">
            <div className="flex items-center gap-2.5">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper-100", group.color)}>
                <Icon name={group.icon} size={18} />
              </span>
              <div>
                <h3 className="display-expanded text-[16px] font-bold text-ink-900">{group.title}</h3>
                <p className="mt-0.5 text-[12px] text-ink-500">{group.desc}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                className={f.span2 ? "sm:col-span-2" : ""}
              >
                {f.type === "select" ? (
                  <Select
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {(f.options || []).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                ) : f.type === "textarea" ? (
                  <Textarea
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                    rows={3}
                  />
                ) : (
                  <div className="relative">
                    <Input
                      mono={f.mono || f.type === "number"}
                      type={f.type === "number" ? "number" : "text"}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                      className={f.suffix ? "pr-9" : ""}
                    />
                    {f.suffix && (
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px] text-ink-400">
                        {f.suffix}
                      </span>
                    )}
                  </div>
                )}
              </Field>
            ))}
          </div>

          {/* Bloco informativo por seção */}
          {active === "tributacao" && (
            <div className="mt-5 rounded-lg bg-proc-c-soft px-4 py-3">
              <p className="flex items-center gap-2 text-[12px] leading-relaxed text-proc-c-strong">
                <Icon name="info" size={14} className="shrink-0" />
                Exemplo: venda de R$ 100 com imposto {form.tax_rate || "6"}% e débito {form.card_fee_debit || "1.99"}% →
                o motor adiciona R$ {((Number(form.tax_rate || 0) + Number(form.card_fee_debit || 0))).toFixed(2).replace(".", ",")} ao custo base.
              </p>
            </div>
          )}



          {active === "fiscal" && (
            <div className="mt-5 rounded-lg bg-paper-100 px-4 py-3">
              <p className="flex items-center gap-2 text-[12px] leading-relaxed text-ink-600">
                <Icon name="info" size={14} className="shrink-0" />
                A emissão real de NF-e / NFC-e / NFS-e depende de integrador externo e certificado digital A1 ou A3.
                As configurações aqui são usadas pelo integrador — não há emissão direto por este sistema.
              </p>
            </div>
          )}

          {active === "pdv" && (
            <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-3">
              <p className="flex items-center gap-2 text-[12px] leading-relaxed text-emerald-800">
                <Icon name="info" size={14} className="shrink-0" />
                As taxas de maquininha (débito e crédito) são configuradas na aba <strong>Precificação & taxas</strong>.
                O nome do vendedor salvo no PDV também é gravado no localStorage do navegador.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
