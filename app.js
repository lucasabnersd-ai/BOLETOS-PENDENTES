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
  auditRefreshButton: document.querySelector("#auditRefreshButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  viewSelect: document.querySelector("#viewSelect"),
  groupBySelect: document.querySelector("#groupBySelect"),
  fonteFilter: document.querySelector("#fonteFilter"),
  origemFilter: document.querySelector("#origemFilter"),
  prioridadeFilter: document.querySelector("#prioridadeFilter"),
  associacaoFilter: document.querySelector("#associacaoFilter"),
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
  auditList: document.querySelector("#auditList"),
  metaBox: document.querySelector("#metaBox"),
  toast: document.querySelector("#toast"),
};

const editableFields = new Set(["situacao_associacao", "checklist", "tratado_pendente", "observacao", "modelo"]);
const state = {
  allRows: [],
  rows: [],
  filters: {},
  meta: null,
  audit: [],
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
  });

  refs.filtersForm.addEventListener("change", () => applyFilters());
  refs.refreshButton.addEventListener("click", () => withBusy(refs.refreshButton, refreshAll));
  refs.auditRefreshButton.addEventListener("click", () => withBusy(refs.auditRefreshButton, loadAudit));
  refs.clearButton.addEventListener("click", () => {
    refs.filtersForm.reset();
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

async function refreshAll() {
  await Promise.all([loadRows(), loadMeta(), loadAudit()]);
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

async function loadAudit() {
  const { data, error } = await supabase
    .from(AUDIT_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    refs.auditList.innerHTML = `<div class="empty">Auditoria indisponivel: ${escapeHtml(error.message)}</div>`;
    return;
  }

  state.audit = data || [];
  renderAudit();
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
    view: String(form.get("view") || "all"),
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
  const vencidos = count(rows, (row) => Number(row.dias_para_vencer ?? 0) < 0 || normalizeText(row.situacao_vencimento).includes("vencido"));
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
  return `
    <tr class="group-row ${isCollapsed ? "collapsed" : ""}">
      <td colspan="3">
        <button class="group-toggle" type="button" data-group-key="${encodedKey}" title="Abrir ou recolher grupo">${isCollapsed ? "+" : "-"}</button>
        <strong>${escapeHtml(group.label)}</strong>
      </td>
      <td class="num">${group.rows.length}</td>
      <td class="num group-total">${formatCurrency(total)}</td>
      <td colspan="3">Pendentes: <strong>${pending}</strong> | Revisao: <strong>${review}</strong> | Prioridade maxima: <strong>${maxPriority}</strong></td>
      <td colspan="7">Subtotal do grupo</td>
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
  return `
    <tr data-id="${escapeHtml(row.id)}">
      <td class="status-column treatment-cell">${renderSelect(row, "tratado_pendente", ["PENDENTE", "TRATADO", "EM ANALISE", "CANCELADO"])}</td>
      <td class="status-column priority-cell">${priorityBadge(row.prioridade)}</td>
      <td class="nowrap">${formatDate(row.vencimento)}</td>
      <td class="num">${escapeHtml(row.dias_para_vencer ?? "-")}</td>
      <td class="num"><span class="money">${formatCurrency(row.valor)}</span></td>
      <td class="supplier-cell">${escapeHtml(row.fornecedor || "-")}</td>
      <td class="nowrap">${escapeHtml(row.cnpj_cpf || "-")}</td>
      <td class="nowrap">${escapeHtml(row.nf_doc_extraido || "-")}</td>
      <td><input class="table-input model-input" data-field="modelo" value="${escapeAttr(row.modelo || row.fonte || "")}" /></td>
      <td class="origin-cell">${escapeHtml(row.origem || "-")}</td>
      <td>${escapeHtml(row.dda_itau || "-")}</td>
      <td>${renderSelect(row, "situacao_associacao", ["SEM PAR ENCONTRADO", "CANDIDATO EM REVISAO", "ASSOCIADO", "DESCARTADO"])}</td>
      <td class="check-cell"><input type="checkbox" data-field="checklist" ${isChecked(row.checklist) ? "checked" : ""} /></td>
      <td class="last-change-cell">
        <strong>${escapeHtml(row.last_changed_by || "Sistema")}</strong>
        <span>${formatDateTime(row.last_changed_at || row.updated_at)}</span>
      </td>
      <td><textarea class="obs-editor" data-field="observacao">${escapeHtml(row.observacao || "")}</textarea></td>
    </tr>
  `;
}

function renderSelect(row, field, options) {
  const current = String(row[field] || "");
  const values = [...new Set([current, ...options].filter(Boolean))];
  const statusClass = field === "tratado_pendente" ? ` treatment-select ${treatmentStatusClass(current)}` : "";
  return `<select class="table-select${statusClass}" data-field="${field}">${values.map((value) => `<option value="${escapeAttr(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`;
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
  const dimension = state.filters.view === "all" ? "fonte" : state.filters.view;
  const labelMap = {
    fonte: "Modelo/Fonte",
    origem: "Origem",
    prioridade: "Prioridade",
    situacao_associacao: "Associacao",
    dda_itau: "DDA Itau",
  };
  const groups = groupBy(state.rows, (row) => row[dimension] || row.fonte || "Sem modelo");
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
  refs.modelCount.textContent = `${entries.length} grupo${entries.length === 1 ? "" : "s"}`;
  if (!entries.length) {
    refs.modelGrid.innerHTML = '<div class="empty">Sem grupos para os filtros atuais.</div>';
    return;
  }
  refs.modelGrid.innerHTML = entries.map(([name, rows]) => {
    const total = sum(rows, (row) => Number(row.valor || 0));
    const pending = count(rows, (row) => normalizeText(row.tratado_pendente) === "pendente");
    const review = count(rows, (row) => normalizeText(row.situacao_associacao).includes("revisao"));
    return `
      <article class="model-card">
        <div><span>${escapeHtml(labelMap[dimension] || "Grupo")}</span><strong>${escapeHtml(name)}</strong></div>
        <div><span>Boletos</span><strong>${rows.length}</strong></div>
        <div><span>Valor</span><strong>${formatCurrency(total)}</strong></div>
        <div><span>Pendentes</span><strong>${pending}</strong></div>
        <div><span>Revisao</span><strong>${review}</strong></div>
      </article>
    `;
  }).join("");
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

function renderAudit() {
  if (!state.audit.length) {
    refs.auditList.innerHTML = '<div class="empty">Nenhuma auditoria registrada ainda.</div>';
    return;
  }
  refs.auditList.innerHTML = state.audit.map((item) => {
    const before = item.old_value || {};
    const after = item.new_value || {};
    const payload = after.payload || after;
    const action = after.action || "alteracao";
    return `
      <article class="audit-card">
        <strong>${escapeHtml(action)}</strong>
        <span>${formatDateTime(item.created_at)} · ${escapeHtml(payload.field || payload.source || "sistema")}</span>
        <span>${escapeHtml(JSON.stringify({ before, after }).slice(0, 260))}</span>
      </article>
    `;
  }).join("");
}

async function handleTableChange(event) {
  const input = event.target.closest("[data-field]");
  if (!input || !editableFields.has(input.dataset.field)) return;
  await updateRowField(input);
}

async function handleTableBlur(event) {
  const input = event.target.closest("textarea[data-field], input[data-field='modelo']");
  if (!input || input.dataset.savedValue === input.value) return;
  await updateRowField(input);
}

function handleTableClick(event) {
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
  loadAudit();
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
  const headers = ["tratado_pendente", "prioridade", "vencimento", "dias_para_vencer", "valor", "fornecedor", "cnpj_cpf", "nf_doc_extraido", "fonte", "origem", "dda_itau", "situacao_associacao", "checklist", "last_changed_by", "last_changed_at", "observacao"];
  const lines = [headers.join(";")].concat(state.rows.map((row) => headers.map((field) => csvValue(row[field])).join(";")));
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
  const days = Number(row.dias_para_vencer ?? 0);
  if (Number.isNaN(days)) return row.situacao_vencimento || "Sem data";
  if (days < 0) return "Vencido";
  if (days === 0) return "Vence hoje";
  if (days <= 3) return "Ate 3 dias";
  if (days <= 7) return "Ate 7 dias";
  return "Acima de 7 dias";
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
