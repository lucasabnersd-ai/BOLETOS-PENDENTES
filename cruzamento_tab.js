let supabase = null;

const fmtBRL = (value) =>
  value == null ? "-" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");

const kpi = (label, value, extraClass = "") =>
  `<article class="panel kpi-card ${extraClass}"><span class="eyebrow">${esc(label)}</span><strong>${esc(value)}</strong></article>`;

const confidenceClass = (value) => String(value || "").toUpperCase() === "ALTA"
  ? "confidence-high"
  : "confidence-review";

let cruzamento = null;

function render() {
  const meta = document.querySelector("#cruzamentoMeta");
  const kpis = document.querySelector("#cruzamentoKpis");
  const body = document.querySelector("#cruzamentoRowsBody");
  const count = document.querySelector("#cruzamentoCount");
  if (!cruzamento) {
    if (meta) meta.textContent = "Sem dados do cruzamento disponíveis.";
    if (body) body.innerHTML = '<tr><td colspan="13" class="empty">Nenhum cruzamento disponível.</td></tr>';
    return;
  }

  const resumo = cruzamento.resumo || {};
  if (meta) meta.textContent = `Gerado em ${cruzamento.gerado_em || "-"} | Base NFes: ${cruzamento.base_nfes || "-"}`;
  if (kpis) kpis.innerHTML = [
    kpi("Total de boletos", resumo.total_boletos ?? 0),
    kpi("Por numero de NF", resumo.por_numero_nf ?? 0),
    kpi("Por CNPJ/Nome + valor", resumo.por_cnpj_valor ?? 0),
    kpi("Sem associacao", resumo.sem_associacao ?? 0),
    kpi("Confianca ALTA", resumo.alta ?? 0),
    kpi("Conferir", resumo.conferir ?? 0),
    kpi("Valor associado", fmtBRL(resumo.valor_associado)),
    kpi("Valor sem associacao", fmtBRL(resumo.valor_sem_associacao)),
  ].join("");

  const search = (document.querySelector("#cruzamentoSearch")?.value || "").trim().toLowerCase();
  const onlyReview = Boolean(document.querySelector("#cruzamentoSoConferir")?.checked);
  const rows = (cruzamento.associados || []).filter((row) => {
    if (onlyReview && row.confianca !== "CONFERIR") return false;
    return !search || [row.fornecedor, row.cnpj, row.nfdoc, row.nf9, row.nf, row.emitente, row.obs]
      .join(" ").toLowerCase().includes(search);
  });
  if (count) count.textContent = `${rows.length} associados`;
  if (body) body.innerHTML = rows.length
    ? rows.map((row) => `<tr>
        <td><span class="pill ${confidenceClass(row.confianca)}">${esc(row.confianca)}</span></td>
        <td>${esc(row.metodo)}</td><td>${esc(row.fornecedor)}</td><td>${esc(row.cnpj)}</td>
        <td>${esc(row.nfdoc)}</td><td class="num">${fmtBRL(row.valor)}</td><td>${esc(row.venc)}</td>
        <td>${esc(row.nf9)}</td><td>${esc(row.emitente)}</td><td>${esc(row.parcela)} ${esc(row.venc_parcela)}</td>
        <td class="num">${fmtBRL(row.vlr_parcela)}</td><td class="num">${row.dif_valor == null ? "-" : fmtBRL(row.dif_valor)}</td><td>${esc(row.obs)}</td>
      </tr>`).join("")
    : '<tr><td colspan="13" class="empty">Nenhum registro com esse filtro.</td></tr>';
}

async function loadCruzamento() {
  const meta = document.querySelector("#cruzamentoMeta");
  supabase ||= window.boletoSupabase;
  if (!supabase) {
    if (meta) meta.textContent = "O painel ainda está iniciando...";
    window.setTimeout(loadCruzamento, 100);
    return;
  }
  const { data, error } = await supabase
    .from("boleto_pendentes_cruzamento")
    .select("value, updated_at")
    .eq("key", "latest_import")
    .maybeSingle();
  if (error) {
    if (meta) meta.textContent = "Não foi possível carregar o cruzamento.";
    return;
  }
  cruzamento = data?.value || null;
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#cruzamentoSearch")?.addEventListener("input", render);
  document.querySelector("#cruzamentoSoConferir")?.addEventListener("change", render);
  loadCruzamento();
});
