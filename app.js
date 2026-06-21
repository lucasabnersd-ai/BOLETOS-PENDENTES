import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://pyrniqluywejmgzqkari.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fXWQGDirOvs5xfxZDaSOtg_Jgd7vcbu";
const ITEMS_TABLE = "boleto_pendentes_items";
const META_TABLE = "boleto_pendentes_meta";
const AUDIT_TABLE = "boleto_pendentes_audit";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 3 } },
});

const refs = {
  apiStatus: document.querySelector("#apiStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  rowStatus: document.querySelector("#rowStatus"),
  filtersForm: document.querySelector("#filtersForm"),
  operatorName: document.querySelector("#operatorName"),
  refreshButton: document.querySelector("#refreshButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  groupBySelect: document.querySelector("#groupBySelect"),
  fonteFilter: document.querySelector("#fonteFilter"),
  origemFilter: document.querySelector("#origemFilter"),
  prioridadeFilter: document.querySelector("#prioridadeFilter"),
  associacaoFilter: document.querySelector("#associacaoFilter"),
  dueQuickFilters: document.querySelector("#dueQuickFilters"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  tableWrap: document.querySelector(".table-wrap"),
  rowsBody: document.querySelector("#rowsBody"),
  resultCount: document.querySelector("#resultCount"),
  filteredStatus: document.querySelector("#filteredStatus"),
  overdueStatus: document.querySelector("#overdueStatus"),
  kpiGrid: document.querySelector("#kpiGrid"),
  priorityBars: document.querySelector("#priorityBars"),
  dueBars: document.querySelector("#dueBars"),
  modelGrid: document.querySelector("#modelGrid"),
  modelCount: document.querySelector("#modelCount"),
  metaBox: document.querySelector("#metaBox"),
  toast: document.querySelector("#toast"),
};

const editableFields = new Set(["tratado_pendente"]);
const copyableFields = new Set(["linha_digitavel", "codigo_barras"]);
const state = {
  allRows: [],
  rows: [],
  filters: {},
  meta: null,
  loadedAt: null,
  collapsedGroups: new Set(),
};

init();

async function init() {
  bindEvents();
  renderEmptySelects();
  await refreshAll();
  startRealtime();
  setInterval(refreshAllQuietly, 60000);
}

function bindEvents() {
  refs.operatorName.value = localStorage.getItem("boletos_operator_name") || "";
  refs.operatorName.addEventListener("input", () => {
    localStorage.setItem("boletos_operator_name", refs.operatorName.value.trim());
  });

  refs.filtersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
  });

  refs.filtersForm.addEventListener("input", (event) => {
    if (event.target.matches('[data-mask="currency"]')) maskCurrencyInput(event.target);
    if (event.target.matches('[data-mask="date"]')) maskDateInput(event.target);
    if (event.target === refs.startDate || event.target === refs.endDate) clearDueQuickFilterSelection();
  });

  refs.filtersForm.addEventListener("change", () => applyFilters());
  refs.dueQuickFilters.addEventListener("click", handleDueQuickFilter);
  refs.refreshButton.addEventListener("click", () => withBusy(refs.refreshButton, refreshAll));
  refs.clearButton.addEventListener("click", () => {
    refs.filtersForm.reset();
    clearDueQuickFilterSelection();
    applyFilters();
  });
  refs.exportButton.addEventListener("click", exportCsv);

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  refs.rowsBody.addEventListener("change", handleTableChange);
  refs.rowsBody.addEventListener("blur", handleTableBlur, true);
  refs.rowsBody.addEventListener("click", handleTableClick);
  enableHorizontalDrag(refs.tableWrap);
}

function handleDueQuickFilter(event) {
  const button = event.target.closest(".due-filter-button");
  if (!button) return;

  const wasActive = button.classList.contains("active");
  clearDueQuickFilterSelection();

  if (wasActive) {
    refs.startDate.value = "";
    refs.endDate.value = "";
    applyFilters();
    return;
  }

  const days = Number(button.dataset.dueDays || 0);
  const isRange = button.dataset.dueMode === "range";
  refs.startDate.value = formatInputDate(daysFromToday(isRange ? 1 : days));
  refs.endDate.value = formatInputDate(daysFromToday(days));
  button.classList.add("active");
  button.setAttribute("aria-pressed", "true");
  applyFilters();
}

function clearDueQuickFilterSelection() {
  refs.dueQuickFilters.querySelectorAll(".due-filter-button").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
}

function daysFromToday(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function formatInputDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

async function refreshAll() {
  await Promise.all([loadRows(), loadMeta()]);
  refs.apiStatus.textContent = "Supabase online";
  refs.apiStatus.classList.remove("muted", "danger");
}

async function refreshAllQuietly() {
  try {
    await refreshAll();
  } catch (error) {
    setApiOffline(error);
  }
}

async function loadRows() {
  const { data, error } = await supabase
    .from(ITEMS_TABLE)
    .select("*")
    .order("vencimento", { ascending: true, nullsFirst: false })
    .order("fornecedor", { ascending: true, nullsFirst: false })
    .limit(5000);

  if (error) {
    setApiOffline(error);
    throw error;
  }

  state.allRows = data || [];
  state.loadedAt = new Date();
  refs.rowStatus.textContent = `${state.allRows.length} boleto${state.allRows.length === 1 ? "" : "s"}`;
  populateFilterOptions();
  applyFilters();
}

async function loadMeta() {
  const { data, error } = await supabase
    .from(META_TABLE)
    .select("key,value,updated_at")
    .eq("key", "latest_import")
    .maybeSingle();

  if (error) return;
  state.meta = data?.value || null;
  renderMeta();
}

function setApiOffline(error) {
  refs.apiStatus.textContent = "Supabase offline";
  refs.apiStatus.classList.add("danger");
  refs.apiStatus.title = error?.message || "";
}

function startRealtime() {
  supabase
    .channel("boleto-pendentes-live")
    .on("postgres_changes", { event: "*", schema: "public", table: ITEMS_TABLE }, () => {
      refreshAllQuietly();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        refs.apiStatus.textContent = "Supabase online";
        refs.apiStatus.classList.remove("muted", "danger");
      }
    });
}

function renderEmptySelects() {
  fillSelect(refs.fonteFilter, [], "Todos os modelos");
  fillSelect(refs.origemFilter, [], "Todas as origens");
  fillSelect(refs.prioridadeFilter, [], "Todas as prioridades");
  fillSelect(refs.associacaoFilter, [], "Todas as associacoes");
}

function populateFilterOptions() {
  const current = {
    fonte: refs.fonteFilter.value,
    origem: refs.origemFilter.value,
    prioridade: refs.prioridadeFilter.value,
    associacao: refs.associacaoFilter.value,
  };
  fillSelect(refs.fonteFilter, uniqueValues(state.allRows, (row) => row.fonte || row.modelo), "Todos os modelos");
  fillSelect(refs.origemFilter, uniqueValues(state.allRows, (row) => row.origem), "Todas as origens");
  fillSelect(refs.prioridadeFilter, uniqueValues(state.allRows, (row) => row.prioridade), "Todas as prioridades");
  fillSelect(refs.associacaoFilter, uniqueValues(state.allRows, (row) => row.situacao_associacao), "Todas as associacoes");
  refs.fonteFilter.value = current.fonte;
  refs.origemFilter.value = current.origem;
  refs.prioridadeFilter.value = current.prioridade;
  refs.associacaoFilter.value = current.associacao;
}

function fillSelect(select, values, label) {
  const options = [`<option value="">${escapeHtml(label)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
  select.innerHTML = options.join("");
}

function uniqueValues(rows, getter) {
  return [...new Set(rows.map(getter).filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function applyFilters() {
  const form = new FormData(refs.filtersForm);
  const filters = {
    search: normalizeText(form.get("search")),
    fonte: String(form.get("fonte") || ""),
    origem: String(form.get("origem") || ""),
    prioridade: String(form.get("prioridade") || ""),
    situacaoAssociacao: String(form.get("situacao_associacao") || ""),
    minValue: parseCurrency(form.get("min_value")),
    maxValue: parseCurrency(form.get("max_value")),
    startDate: normalizeDate(form.get("start_date")),
    endDate: normalizeDate(form.get("end_date")),
    pendingOnly: Boolean(form.get("pending_only")),
    groupBy: String(form.get("group_by") || ""),
  };
  state.filters = filters;
  state.rows = state.allRows.filter((row) => rowMatches(row, filters));
  renderAll();
}

function rowMatches(row, filters) {
  if (filters.search) {
    const haystack = normalizeText([
      row.fornecedor,
      row.cnpj_cpf,
      row.nf_doc_extraido,
      row.origem,
      row.fonte,
      row.assunto,
      row.remetente,
      row.linha_digitavel,
      row.codigo_barras,
      row.observacao,
      row.last_changed_by,
    ].join(" "));
    if (!haystack.includes(filters.search)) return false;
  }
  if (filters.fonte && filters.fonte !== (row.fonte || row.modelo || "")) return false;
  if (filters.origem && filters.origem !== (row.origem || "")) return false;
  if (filters.prioridade && filters.prioridade !== (row.prioridade || "")) return false;
  if (filters.situacaoAssociacao && filters.situacaoAssociacao !== (row.situacao_associacao || "")) return false;
  if (filters.pendingOnly && normalizeText(row.tratado_pendente) !== "pendente") return false;
  const value = Number(row.valor || 0);
  if (Number.isFinite(filters.minValue) && value < filters.minValue) return false;
  if (Number.isFinite(filters.maxValue) && value > filters.maxValue) return false;
  if (filters.startDate && String(row.vencimento || "") < filters.startDate) return false;
  if (filters.endDate && String(row.vencimento || "") > filters.endDate) return false;
  return true;
}

function renderAll() {
  renderKpis();
  renderBars();
  renderRows();
  renderModels();
  renderMeta();
}

function renderKpis() {
  const rows = state.rows;
  const totalValue = sum(rows, (row) => Number(row.valor || 0));
  const maxPriority = count(rows, (row) => normalizeText(row.prioridade).includes("maxima"));
  const vencidos = count(rows, (row) => {
    const days = daysUntilDue(row.vencimento);
    return days == null ? normalizeText(row.situacao_vencimento).includes("vencido") : days < 0;
  });
  const dda = count(rows, (row) => normalizeText(row.dda_itau) === "sim");
  const revisao = count(rows, (row) => normalizeText(row.situacao_associacao).includes("revisao"));
  const cards = [
    ["Boletos filtrados", formatInteger(rows.length)],
    ["Valor total", formatCurrency(totalValue)],
    ["Prioridade maxima", formatInteger(maxPriority)],
    ["Vencidos/criticos", formatInteger(vencidos)],
    ["Candidatos revisao", formatInteger(revisao)],
    ["DDA Itau", formatInteger(dda)],
  ];
  refs.kpiGrid.innerHTML = cards
    .map(([label, value]) => `<article class="kpi-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`)
    .join("");
  refs.filteredStatus.textContent = `${rows.length} filtrado${rows.length === 1 ? "" : "s"}`;
  refs.overdueStatus.textContent = `${vencidos} vencido${vencidos === 1 ? "" : "s"}`;
}

function renderBars() {
  refs.priorityBars.innerHTML = renderGroupBars(groupBy(state.rows, (row) => row.prioridade || "Sem prioridade"), state.rows.length);
  refs.dueBars.innerHTML = renderGroupBars(groupBy(state.rows, dueBucket), state.rows.length);
}

function renderGroupBars(groups, total) {
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
  if (!entries.length) return '<div class="empty">Sem dados para exibir.</div>';
  return entries.map(([label, rows]) => {
    const pct = total ? Math.round((rows.length / total) * 100) : 0;
    return `
      <div class="bar-item">
        <div class="bar-top"><span>${escapeHtml(label)}</span><span>${rows.length} (${pct}%)</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");
}

function renderRows() {
  refs.resultCount.textContent = `${state.rows.length} registro${state.rows.length === 1 ? "" : "s"}`;
  if (!state.rows.length) {
    refs.rowsBody.innerHTML = '<tr><td colspan="15" class="empty">Nenhum boleto encontrado para os filtros atuais.</td></tr>';
    return;
  }
  refs.rowsBody.innerHTML = renderGroupedRows();
}

function renderGroupedRows() {
  const groupByField = state.filters.groupBy || "";
  if (!groupByField) return state.rows.map(renderRow).join("");

  const groups = groupRowsForTable(state.rows, groupByField);
  return groups.map((group) => {
    const isCollapsed = state.collapsedGroups.has(group.key);
    const subtotal = renderGroupHeader(group, isCollapsed);
    const children = isCollapsed ? "" : group.rows.map(renderRow).join("");
    return subtotal + children;
  }).join("");
}

function groupRowsForTable(rows, field) {
  const groups = new Map();
  rows.forEach((row) => {
    const rawKey = groupKey(row, field);
    const key = `${field}:${rawKey}`;
    if (!groups.has(key)) {
      groups.set(key, { key, rawKey, label: groupLabel(row, field, rawKey), rows: [] });
    }
    groups.get(key).rows.push(row);
  });

  return [...groups.values()].sort((a, b) => {
    if (field === "vencimento") return String(a.rawKey).localeCompare(String(b.rawKey), "pt-BR");
    return b.rows.length - a.rows.length || a.label.localeCompare(b.label, "pt-BR");
  });
}

function renderGroupHeader(group, isCollapsed) {
  const total = sum(group.rows, (row) => Number(row.valor || 0));
  const pending = count(group.rows, (row) => normalizeText(row.tratado_pendente) === "pendente");
  const review = count(group.rows, (row) => normalizeText(row.situacao_associacao).includes("revisao"));
  const maxPriority = count(group.rows, (row) => normalizeText(row.prioridade).includes("maxima"));
  const encodedKey = escapeAttr(group.key);
  const weekend = state.filters.groupBy === "vencimento" ? renderWeekendIndicator(group.rawKey) : "";
  return `
    <tr class="group-row ${isCollapsed ? "collapsed" : ""}">
      <td colspan="3">
        <button class="group-toggle" type="button" data-group-key="${encodedKey}" title="Abrir ou recolher grupo">${isCollapsed ? "+" : "-"}</button>
        <strong>${escapeHtml(group.label)}</strong>${weekend}
      </td>
      <td class="num">${group.rows.length}</td>
      <td class="num group-total">${formatCurrency(total)}</td>
      <td colspan="4">Pendentes: <strong>${pending}</strong> | Revisao: <strong>${review}</strong> | Prioridade maxima: <strong>${maxPriority}</strong></td>
      <td colspan="6">Subtotal do grupo</td>
    </tr>
  `;
}

function groupKey(row, field) {
  if (field === "vencimento") return row.vencimento || "Sem vencimento";
  return row[field] || "Sem valor";
}

function groupLabel(row, field, rawKey) {
  if (field === "vencimento") return rawKey === "Sem vencimento" ? rawKey : `Vencimento ${formatDate(rawKey)}`;
  const labels = {
    origem: "Origem",
    fonte: "Modelo",
    prioridade: "Prioridade",
    situacao_associacao: "Associacao",
  };
  return `${labels[field] || "Grupo"}: ${rawKey || "Sem valor"}`;
}

function renderRow(row) {
  const days = daysUntilDue(row.vencimento);
  return `
    <tr data-id="${escapeHtml(row.id)}">
      <td class="status-column treatment-cell">${renderSelect(row, "tratado_pendente", ["PENDENTE", "TRATADO", "EM ANALISE", "CANCELADO"])}</td>
      <td class="status-column priority-cell">${priorityBadge(row.prioridade)}</td>
      <td class="nowrap">${formatDate(row.vencimento)}${renderWeekendIndicator(row.vencimento)}</td>
      <td class="num">${days == null ? "-" : escapeHtml(days)}</td>
      <td class="num"><span class="money">${formatCurrency(row.valor)}</span></td>
      <td class="copy-codes-cell">${renderCopyCodeActions(row)}</td>
      <td class="supplier-cell">${escapeHtml(row.fornecedor || "-")}</td>
      <td class="nowrap">${escapeHtml(row.cnpj_cpf || "-")}</td>
      <td class="nowrap">${escapeHtml(row.nf_doc_extraido || "-")}</td>
      <td class="readonly-cell model-cell">${escapeHtml(row.modelo || row.fonte || "-")}</td>
      <td class="origin-cell">${escapeHtml(row.origem || "-")}</td>
      <td>${escapeHtml(row.dda_itau || "-")}</td>
      <td class="check-cell readonly-cell">${isChecked(row.checklist) ? "SIM" : "-"}</td>
      <td class="last-change-cell">
        <strong>${escapeHtml(row.last_changed_by || "Sistema")}</strong>
        <span>${formatDateTime(row.last_changed_at || row.updated_at)}</span>
      </td>
      <td class="readonly-cell observation-cell" title="${escapeAttr(row.observacao || "")}">${escapeHtml(row.observacao || "-")}</td>
    </tr>
  `;
}

function renderSelect(row, field, options) {
  const current = String(row[field] || "");
  const values = [...new Set([current, ...options].filter(Boolean))];
  const statusClass = field === "tratado_pendente" ? ` treatment-select ${treatmentStatusClass(current)}` : "";
  return `<select class="table-select${statusClass}" data-field="${field}">${values.map((value) => `<option value="${escapeAttr(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`;
}

function renderCopyCodeActions(row) {
  return `
    <div class="copy-code-actions">
      ${renderCopyCodeButton(row, "linha_digitavel", "Linha")}
      ${renderCopyCodeButton(row, "codigo_barras", "Barras")}
    </div>
  `;
}

function renderCopyCodeButton(row, field, label) {
  const available = Boolean(normalizeCopyCode(row[field]));
  const description = field === "linha_digitavel" ? "linha digitavel" : "codigo de barras";
  const title = available ? `Copiar ${description}` : `${description} indisponivel`;
  return `<button type="button" class="copy-code-button" data-copy-field="${field}" title="${title}" aria-label="${title}" ${available ? "" : "disabled"}><span class="copy-code-icon" aria-hidden="true"></span><span>${label}</span></button>`;
}

function treatmentStatusClass(value) {
  const key = normalizeText(value);
  if (key === "em analise") return "status-analysis";
  if (key === "tratado") return "status-treated";
  if (key === "cancelado") return "status-cancelled";
  return "status-pending";
}

function priorityBadge(value) {
  const text = value || "-";
  const key = normalizeText(text);
  const cls = key.includes("maxima") ? "max" : key.includes("media") ? "mid" : key.includes("vencido") ? "old" : "";
  return `<span class="priority ${cls}">${escapeHtml(text)}</span>`;
}

function renderModels() {
  const groups = groupBy(state.rows, (row) => row.fonte || row.modelo || "Sem fonte");
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
  refs.modelCount.textContent = `${entries.length} grupo${entries.length === 1 ? "" : "s"}`;
  if (!entries.length) {
    refs.modelGrid.innerHTML = '<div class="empty">Sem grupos para os filtros atuais.</div>';
    return;
  }
  const rowsTotal = state.rows.length;
  refs.modelGrid.innerHTML = `
    <div class="model-table" role="table" aria-label="Distribuicao dos boletos">
      <div class="model-table-header" role="row">
        <span role="columnheader">Fonte</span>
        <span role="columnheader" class="num">Boletos</span>
        <span role="columnheader" class="num">Valor</span>
        <span role="columnheader" class="num">Pendentes</span>
        <span role="columnheader" class="num">Em revisao</span>
      </div>
      ${entries.map(([name, rows]) => {
    const total = sum(rows, (row) => Number(row.valor || 0));
    const pending = count(rows, (row) => normalizeText(row.tratado_pendente) === "pendente");
    const review = count(rows, (row) => normalizeText(row.situacao_associacao).includes("revisao"));
    const share = rowsTotal ? Math.round((rows.length / rowsTotal) * 100) : 0;
    const pendingShare = rows.length ? Math.round((pending / rows.length) * 100) : 0;
    return `
        <div class="model-table-row" role="row">
          <div class="model-source" role="cell">
            <div class="model-source-line">
              <strong>${escapeHtml(name)}</strong>
              <span>${share}% da base</span>
            </div>
            <div class="model-share-track" aria-hidden="true"><span style="width:${share}%"></span></div>
          </div>
          <strong class="model-number" role="cell">${formatInteger(rows.length)}</strong>
          <strong class="model-value" role="cell">${formatCurrency(total)}</strong>
          <span class="model-status pending" role="cell"><strong>${formatInteger(pending)}</strong><small>${pendingShare}%</small></span>
          <span class="model-status review" role="cell"><strong>${formatInteger(review)}</strong></span>
        </div>
      `;
      }).join("")}
    </div>
  `;
}

function renderMeta() {
  const meta = state.meta || {};
  const updatedAt = meta.generated_at || meta.finished_at || meta.updated_at || state.loadedAt?.toISOString();
  refs.syncStatus.textContent = updatedAt ? `Atualizado ${formatDateTime(updatedAt)}` : "Atualizacao nao informada";
  refs.syncStatus.classList.toggle("muted", !updatedAt);

  const rows = [
    ["Planilha", meta.workbook_name || "BOLETOS PENDENTES A ASSOCIAR.xlsx"],
    ["Ultima leitura", updatedAt ? formatDateTime(updatedAt) : "-"],
    ["Linhas importadas", meta.row_count ?? state.allRows.length ?? 0],
    ["Valor total", meta.total_value != null ? formatCurrency(meta.total_value) : formatCurrency(sum(state.allRows, (row) => Number(row.valor || 0)))],
  ];
  if (refs.metaBox) {
    refs.metaBox.innerHTML = rows.map(([key, value]) => `<div class="meta-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }
}

async function handleTableChange(event) {
  const input = event.target.closest("[data-field]");
  if (!input || !editableFields.has(input.dataset.field)) return;
  await updateRowField(input);
}

async function handleTableBlur(event) {
  const input = event.target.closest("[data-field]");
  if (!input || input.dataset.savedValue === input.value) return;
  if (!editableFields.has(input.dataset.field)) return;
  await updateRowField(input);
}

async function handleTableClick(event) {
  const copyButton = event.target.closest(".copy-code-button");
  if (copyButton) {
    await copyRowCode(copyButton);
    return;
  }

  const button = event.target.closest(".group-toggle");
  if (!button) return;
  const key = button.dataset.groupKey;
  if (!key) return;
  if (state.collapsedGroups.has(key)) {
    state.collapsedGroups.delete(key);
  } else {
    state.collapsedGroups.add(key);
  }
  renderRows();
}

async function copyRowCode(button) {
  const field = button.dataset.copyField;
  const rowId = button.closest("tr[data-id]")?.dataset.id;
  if (!rowId || !copyableFields.has(field)) return;
  const row = state.allRows.find((item) => item.id === rowId);
  const value = normalizeCopyCode(row?.[field]);
  if (!value) {
    toast("Codigo indisponivel.");
    return;
  }

  try {
    await writeClipboard(value);
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 1200);
    toast(field === "linha_digitavel" ? "Linha digitavel copiada." : "Codigo de barras copiado.");
  } catch (error) {
    toast("Nao foi possivel copiar o codigo.");
  }
}

function normalizeCopyCode(value) {
  return String(value || "").replace(/\D/g, "");
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      // Continue with the compatible fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard indisponivel");
}

function enableHorizontalDrag(scroller) {
  if (!scroller) return;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let dragging = false;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea, a, label")) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = scroller.scrollLeft;
    dragging = false;
    scroller.setPointerCapture?.(pointerId);
  });

  scroller.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragging && (Math.abs(deltaX) < 5 || Math.abs(deltaX) <= Math.abs(deltaY))) return;
    dragging = true;
    scroller.classList.add("is-dragging");
    scroller.scrollLeft = startScrollLeft - deltaX;
    event.preventDefault();
  });

  const stopDragging = (event) => {
    if (pointerId !== event.pointerId) return;
    if (scroller.hasPointerCapture?.(pointerId)) scroller.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
    scroller.classList.remove("is-dragging");
  };

  scroller.addEventListener("pointerup", stopDragging);
  scroller.addEventListener("pointercancel", stopDragging);
  scroller.addEventListener("lostpointercapture", () => {
    pointerId = null;
    dragging = false;
    scroller.classList.remove("is-dragging");
  });
}

async function updateRowField(input) {
  const rowEl = input.closest("tr[data-id]");
  if (!rowEl) return;
  const id = rowEl.dataset.id;
  const field = input.dataset.field;
  const row = state.allRows.find((item) => item.id === id);
  if (!row) return;
  const value = input.type === "checkbox" ? input.checked : input.value;
  const previous = {
    [field]: row[field],
    last_changed_by: row.last_changed_by,
    last_changed_at: row.last_changed_at,
  };
  const changedBy = currentOperatorName();
  const changedAt = new Date().toISOString();
  input.disabled = true;
  try {
    const payload = { [field]: value, last_changed_by: changedBy, last_changed_at: changedAt };
    const { data, error } = await supabase
      .from(ITEMS_TABLE)
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    Object.assign(row, data);
    input.dataset.savedValue = input.value;
    await recordAudit(id, "painel_update", { field, value, changed_by: changedBy, changed_at: changedAt, source: "painel_web" }, previous);
    toast("Alteracao salva.");
    applyFilters();
  } catch (error) {
    toast(error.message || "Nao foi possivel salvar.");
  } finally {
    input.disabled = false;
  }
}

async function recordAudit(itemId, action, payload, oldValue = null) {
  await supabase.from(AUDIT_TABLE).insert({
    item_id: itemId,
    field_name: payload.field || action,
    old_value: oldValue,
    new_value: { action, payload },
  });
}

function currentOperatorName() {
  const value = refs.operatorName.value.trim() || localStorage.getItem("boletos_operator_name") || "";
  return value.trim() || "Nao informado";
}

function activateTab(tab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tab}Tab`);
  });
  document.body.classList.toggle("boletos-mode", tab === "boletos");
}

function exportCsv() {
  const headers = ["tratado_pendente", "prioridade", "vencimento", "dias_para_vencer", "valor", "fornecedor", "cnpj_cpf", "nf_doc_extraido", "fonte", "origem", "dda_itau", "checklist", "last_changed_by", "last_changed_at", "observacao"];
  const lines = [headers.join(";")].concat(state.rows.map((row) => headers.map((field) => {
    const value = field === "dias_para_vencer" ? daysUntilDue(row.vencimento) : row[field];
    return csvValue(value);
  }).join(";")));
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `boletos-pendentes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function groupBy(rows, getter) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(getter(row) || "Sem grupo");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function dueBucket(row) {
  const days = daysUntilDue(row.vencimento);
  if (days == null) return row.situacao_vencimento || "Sem data";
  if (days < 0) return "Vencido";
  if (days === 0) return "Vence hoje";
  if (days <= 3) return "Ate 3 dias";
  if (days <= 7) return "Ate 7 dias";
  return "Acima de 7 dias";
}

function daysUntilDue(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const dueDate = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  const todayDate = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dueDate - todayDate) / 86400000);
}

function count(rows, predicate) {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + getter(row), 0);
}

function parseCurrency(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const number = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : NaN;
}

function maskCurrencyInput(input) {
  const digits = input.value.replace(/\D/g, "");
  if (!digits) {
    input.value = "";
    return;
  }
  input.value = (Number(digits) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function maskDateInput(input) {
  const digits = input.value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  input.value = parts.join("/");
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCurrency(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : escapeHtml(value);
}

function renderWeekendIndicator(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  const weekDay = date.getDay();
  if (weekDay !== 0 && weekDay !== 6) return "";

  const isSaturday = weekDay === 6;
  const label = isSaturday ? "SAB" : "DOM";
  const className = isSaturday ? "saturday" : "sunday";
  const description = isSaturday ? "Vencimento no sabado" : "Vencimento no domingo";
  return `<span class="weekend-indicator ${className}" title="${description}" aria-label="${description}"><span class="weekend-calendar-icon" aria-hidden="true"></span><strong>${label}</strong></span>`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", "");
}

function isChecked(value) {
  return value === true || normalizeText(value) === "sim" || normalizeText(value) === "ok" || normalizeText(value) === "true";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    refs.toast.hidden = true;
  }, 4200);
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    toast(error.message || "Erro inesperado.");
  } finally {
    button.disabled = false;
  }
}
