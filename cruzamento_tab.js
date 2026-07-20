let supabase = null;

const fmtBRL = (value) =>
  value == null ? "-" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;");

const confidenceClass = (value) => String(value || "").toUpperCase() === "ALTA"
  ? "confidence-high"
  : "confidence-review";

let cruzamento = null;

function parseCurrency(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  return Number(text.replace(/\./g, "").replace(",", "."));
}

function filteredRows() {
  const search = (document.querySelector("#cruzamentoSearch")?.value || "").trim().toLowerCase();
  const confidence = (document.querySelector("#cruzamentoConfianca")?.value || "").toUpperCase();
  const minValue = parseCurrency(document.querySelector("#cruzamentoValorMin")?.value);
  const maxValue = parseCurrency(document.querySelector("#cruzamentoValorMax")?.value);
  return (cruzamento?.associados || []).filter((row) => {
    const rowConfidence = String(row.confianca || "").toUpperCase();
    const value = parseCurrency(row.valor);
    if (confidence && rowConfidence !== confidence) return false;
    if (Number.isFinite(minValue) && (!Number.isFinite(value) || value < minValue)) return false;
    if (Number.isFinite(maxValue) && (!Number.isFinite(value) || value > maxValue)) return false;
    return !search || [row.fornecedor, row.cnpj, row.nfdoc, row.nf9, row.nf, row.emitente, row.obs]
      .join(" ").toLowerCase().includes(search);
  });
}

function render() {
  const meta = document.querySelector("#cruzamentoMeta");
  const body = document.querySelector("#cruzamentoRowsBody");
  const count = document.querySelector("#cruzamentoCount");
  if (!cruzamento) {
    if (meta) meta.textContent = "Sem dados do cruzamento disponíveis.";
    if (body) body.innerHTML = '<tr><td colspan="13" class="empty">Nenhum cruzamento disponível.</td></tr>';
    return;
  }

  if (meta) meta.textContent = `Gerado em ${cruzamento.gerado_em || "-"} | Base NFes: ${cruzamento.base_nfes || "-"}`;

  const rows = filteredRows();
  if (count) count.textContent = `${rows.length} associados`;
  if (body) body.innerHTML = rows.length
    ? rows.map((row) => `<tr>
        <td><span class="pill ${confidenceClass(row.confianca)}">${esc(row.confianca)}</span></td>
        <td>${esc(row.metodo)}</td><td class="num">${fmtBRL(row.vlr_parcela)}</td><td class="num">${row.dif_valor == null ? "-" : fmtBRL(row.dif_valor)}</td><td>${esc(row.obs)}</td><td>${esc(row.fornecedor)}</td><td>${esc(row.cnpj)}</td>
        <td>${esc(row.nfdoc)}</td><td class="num">${fmtBRL(row.valor)}</td><td>${esc(row.venc)}</td>
        <td>${esc(row.nf9)}</td><td>${esc(row.emitente)}</td><td>${esc(row.parcela)} ${esc(row.venc_parcela)}</td>
      </tr>`).join("")
    : '<tr><td colspan="13" class="empty">Nenhum registro com esse filtro.</td></tr>';
}

function exportCrossingExcel() {
  const exporter = window.downloadBoletoExcel;
  const meta = document.querySelector("#cruzamentoMeta");
  if (!exporter) {
    if (meta) meta.textContent = "A exportação ainda está iniciando. Tente novamente em alguns segundos.";
    return;
  }
  const rows = filteredRows().map((row) => ({
    Confianca: row.confianca,
    Metodo: row.metodo,
    Valor_parcela: Number.isFinite(parseCurrency(row.vlr_parcela)) ? parseCurrency(row.vlr_parcela) : "",
    Diferenca_parcela: Number.isFinite(parseCurrency(row.dif_valor)) ? parseCurrency(row.dif_valor) : "",
    Observacao: row.obs,
    Fornecedor_boleto: row.fornecedor,
    CNPJ_CPF: row.cnpj,
    NF_DOC_extraido: row.nfdoc,
    Valor_boleto: Number.isFinite(parseCurrency(row.valor)) ? parseCurrency(row.valor) : "",
    Vencimento_boleto: row.venc,
    NF_9_digitos: row.nf9,
    Emitente_NF: row.emitente,
    Parcela: row.parcela,
    Vencimento_parcela: row.venc_parcela,
  }));
  exporter(`cruzamento-nfes-${new Date().toISOString().slice(0, 10)}.xlsx`, "Cruzamento NFes", rows);
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
  ["#cruzamentoSearch", "#cruzamentoValorMin", "#cruzamentoValorMax"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", render);
  });
  document.querySelector("#cruzamentoConfianca")?.addEventListener("change", render);
  document.querySelector("#cruzamentoExportButton")?.addEventListener("click", exportCrossingExcel);
  loadCruzamento();
});
