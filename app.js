import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";

const SUPABASE_URL = "https://pyrniqluywejmgzqkari.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fXWQGDirOvs5xfxZDaSOtg_Jgd7vcbu";
const ITEMS_TABLE = "boleto_pendentes_items";
const META_TABLE = "boleto_pendentes_meta";
const AUDIT_TABLE = "boleto_pendentes_audit";
const ADMIN_EMAIL = "lucas.abnersd@gmail.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 3 } },
});

const refs = {
  authGate: document.querySelector("#authGate"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  loginError: document.querySelector("#loginError"),
  userDisplayName: document.querySelector("#userDisplayName"),
  userRole: document.querySelector("#userRole"),
  logoutButton: document.querySelector("#logoutButton"),
  apiStatus: document.querySelector("#apiStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  rowStatus: document.querySelector("#rowStatus"),
  filtersForm: document.querySelector("#filtersForm"),
  refreshButton: document.querySelector("#refreshButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  treatedFilter: document.querySelector("#treatedFilter"),
  fonteFilter: document.querySelector("#fonteFilter"),
  origemFilter: document.querySelector("#origemFilter"),
  prioridadeFilter: document.querySelector("#prioridadeFilter"),
  associacaoFilter: document.querySelector("#associacaoFilter"),
  dueQuickFilters: document.querySelector("#dueQuickFilters"),
  sourceScopeFilters: document.querySelector("#sourceScopeFilters"),
  sourceScope: document.querySelector("#sourceScope"),
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
  treatmentDialog: document.querySelector("#treatmentDialog"),
  treatmentForm: document.querySelector("#treatmentForm"),
  treatmentText: document.querySelector("#treatmentText"),
  treatmentContext: document.querySelector("#treatmentContext"),
  treatmentCloseButton: document.querySelector("#treatmentCloseButton"),
  treatmentCancelButton: document.querySelector("#treatmentCancelButton"),
  treatmentSaveButton: document.querySelector("#treatmentSaveButton"),
  treatmentViewDialog: document.querySelector("#treatmentViewDialog"),
  treatmentViewContext: document.querySelector("#treatmentViewContext"),
  treatmentViewList: document.querySelector("#treatmentViewList"),
  treatmentViewCloseButton: document.querySelector("#treatmentViewCloseButton"),
  toast: document.querySelector("#toast"),
};

const editableFields = new Set(["tratado_pendente"]);
const copyableFields = new Set(["linha_digitavel", "codigo_barras"]);
const state = {
  allRows: [],
  rows: [],
  filters: {},
  meta: null,
  treatments: new Map(),
  loadedAt: null,
  session: null,
  user: null,
  role: "standard",
  realtimeChannel: null,
  refreshTimer: null,
  savingRows: new Set(),
  suppressRealtimeUntil: 0,
};

init();

async function init() {
  bindEvents();
  renderEmptySelects();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showLogin("Nao foi possivel verificar a sessao.");
    return;
  }
  if (data.session) {
    await activateSession(data.session);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) queueMicrotask(() => deactivateSession());
  });
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", handleLogin);
  refs.logoutButton.addEventListener("click", handleLogout);

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
  refs.sourceScopeFilters.addEventListener("click", handleSourceScopeFilter);
  refs.refreshButton.addEventListener("click", () => withBusy(refs.refreshButton, refreshAll));
  refs.clearButton.addEventListener("click", () => {
    refs.filtersForm.reset();
    clearDueQuickFilterSelection();
    setSourceScope("all");
    applyFilters();
  });
  refs.exportButton.addEventListener("click", exportCsv);

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  refs.rowsBody.addEventListener("change", handleTableChange);
  refs.rowsBody.addEventListener("blur", handleTableBlur, true);
  refs.rowsBody.addEventListener("click", handleTableClick);
  refs.treatmentForm.addEventListener("submit", saveTreatment);
  refs.treatmentCloseButton.addEventListener("click", closeTreatmentDialog);
  refs.treatmentCancelButton.addEventListener("click", closeTreatmentDialog);
  refs.treatmentViewCloseButton.addEventListener("click", () => refs.treatmentViewDialog.close());
  refs.treatmentViewList.addEventListener("click", handleTreatmentHistoryClick);
  enableHorizontalDrag(refs.tableWrap);
}

async function handleLogin(event) {
  event.preventDefault();
  refs.loginError.hidden = true;
  refs.loginButton.disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: refs.loginEmail.value.trim(),
      password: refs.loginPassword.value,
    });
    if (error) throw error;
    refs.loginPassword.value = "";
    await activateSession(data.session);
  } catch (error) {
    showLogin("E-mail ou senha invalidos.");
  } finally {
    refs.loginButton.disabled = false;
  }
}

async function handleLogout() {
  refs.logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    deactivateSession();
  } catch (error) {
    toast(error.message || "Nao foi possivel sair.");
  } finally {
    refs.logoutButton.disabled = false;
  }
}

async function activateSession(session) {
  if (!session?.user) {
    showLogin();
    return;
  }
  state.session = session;
  state.user = session.user;
  state.role = isAuthorizedAdmin(session.user) ? "admin" : "standard";

  const displayName = authenticatedDisplayName();
  refs.userDisplayName.textContent = displayName;
  refs.userRole.textContent = state.role === "admin" ? "Administrador" : "Acesso padrão";
  refs.loginError.hidden = true;
  document.body.classList.remove("auth-pending");
  document.body.classList.add("is-authenticated");
  activateTab("boletos");

  await refreshAll();
  startRealtime();
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshAllQuietly, 60000);
}

function deactivateSession() {
  state.session = null;
  state.user = null;
  state.role = "standard";
  state.allRows = [];
  state.rows = [];
  state.treatments = new Map();
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  showLogin();
}

function showLogin(message = "") {
  document.body.classList.remove("is-authenticated");
  document.body.classList.remove("auth-pending");
  refs.loginError.textContent = message;
  refs.loginError.hidden = !message;
  refs.loginEmail.focus();
}

function authenticatedDisplayName() {
  return String(state.user?.app_metadata?.display_name || state.user?.email || "Usuario").trim();
}

function normalizedEmail(user) {
  return String(user?.email || "").trim().toLowerCase();
}

function isAuthorizedAdmin(user) {
  return user?.app_metadata?.app_role === "admin" && normalizedEmail(user) === ADMIN_EMAIL;
}

function authenticatedAuditIdentity() {
  return {
    changed_by: authenticatedDisplayName(),
    changed_by_user_id: state.user?.id || null,
    changed_by_email: state.user?.email || null,
    changed_by_role: state.role,
  };
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

function handleSourceScopeFilter(event) {
  const button = event.target.closest(".scope-filter-button");
  if (!button) return;
  setSourceScope(button.dataset.scope || "all");
  applyFilters();
}

function setSourceScope(scope) {
  refs.sourceScope.value = scope;
  refs.sourceScopeFilters.querySelectorAll(".scope-filter-button").forEach((button) => {
    const active = button.dataset.scope === scope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
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
  if (!state.session) return;
  await Promise.all([loadRows(), loadMeta(), loadTreatments()]);
  applyFilters();
  refs.apiStatus.textContent = "Supabase online";
  refs.apiStatus.classList.remove("muted", "danger");
}

async function refreshAllQuietly() {
  if (!state.session) return;
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

async function loadTreatments() {
  const { data, error } = await supabase
    .from(AUDIT_TABLE)
    .select("id,item_id,new_value,created_at")
    .eq("field_name", "tratativa")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw error;
  const treatments = new Map();
  (data || []).forEach((item) => {
    const itemId = String(item.item_id || "");
    if (!itemId) return;
    const newValue = parseAuditJson(item.new_value);
    const payload = newValue?.payload || newValue || {};
    const value = String(payload.value || "").trim();
    if (!value) return;
    const history = treatments.get(itemId) || [];
    history.push({
      auditId: String(item.id || ""),
      value: String(payload.value || ""),
      changedBy: String(payload.changed_by || "Nao informado"),
      changedAt: payload.changed_at || item.created_at,
    });
    treatments.set(itemId, history);
  });
  state.treatments = treatments;
}

function parseAuditJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function setApiOffline(error) {
  refs.apiStatus.textContent = "Supabase offline";
  refs.apiStatus.classList.add("danger");
  refs.apiStatus.title = error?.message || "";
}

function startRealtime() {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = supabase
    .channel("boleto-pendentes-live")
    .on("postgres_changes", { event: "*", schema: "public", table: ITEMS_TABLE }, () => {
      if (Date.now() < state.suppressRealtimeUntil) return;
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
  fillSelect(refs.fonteFilter, [], "Todas as fontes");
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
  fillSelect(refs.fonteFilter, uniqueValues(state.allRows, sourceName), "Todas as fontes");
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

function sourceName(row) {
  const value = String(row?.fonte || row?.modelo || "").trim();
  return normalizeText(value).includes("central") ? "CENTRAL DE NOTAS" : value;
}

function applyFilters() {
  const form = new FormData(refs.filtersForm);
  const filters = {
    search: normalizeText(form.get("search")),
    fonte: String(form.get("fonte") || ""),
    origem: String(form.get("origem") || ""),
    prioridade: String(form.get("prioridade") || ""),
    situacaoAssociacao: String(form.get("situacao_associacao") || ""),
    treatedStatus: String(form.get("treated_status") || ""),
    minValue: parseCurrency(form.get("min_value")),
    maxValue: parseCurrency(form.get("max_value")),
    startDate: normalizeDate(form.get("start_date")),
    endDate: normalizeDate(form.get("end_date")),
    sourceScope: String(form.get("source_scope") || "all"),
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
      sourceName(row),
      row.assunto,
      row.remetente,
      row.linha_digitavel,
      row.codigo_barras,
      row.observacao,
      treatmentSearchText(row.id),
      row.last_changed_by,
    ].join(" "));
    if (!haystack.includes(filters.search)) return false;
  }
  if (filters.fonte && filters.fonte !== sourceName(row)) return false;
  if (filters.origem && filters.origem !== (row.origem || "")) return false;
  if (filters.prioridade && filters.prioridade !== (row.prioridade || "")) return false;
  if (filters.situacaoAssociacao && filters.situacaoAssociacao !== (row.situacao_associacao || "")) return false;
  if (filters.treatedStatus && normalizeText(filters.treatedStatus) !== normalizeText(row.tratado_pendente)) return false;
  if (filters.sourceScope === "dda" && normalizeText(row.dda_itau) !== "sim") return false;
  if (filters.sourceScope === "central" && sourceName(row) !== "CENTRAL DE NOTAS") return false;
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
    refs.rowsBody.innerHTML = '<tr><td colspan="14" class="empty">Nenhum boleto encontrado para os filtros atuais.</td></tr>';
    return;
  }
  refs.rowsBody.innerHTML = state.rows.map(renderRow).join("");
}

function renderRow(row) {
  const days = daysUntilDue(row.vencimento);
  return `
    <tr data-id="${escapeHtml(row.id)}">
      <td class="status-column treatment-cell">${renderSelect(row, "tratado_pendente", ["PENDENTE", "TRATADO", "EM ANALISE", "CANCELADO"])}</td>
      <td class="last-change-cell">
        <strong>Por: ${escapeHtml(row.last_changed_by || "Sistema")}</strong>
        <span>${formatDateTime(row.last_changed_at || row.updated_at)}</span>
      </td>
      <td class="treatment-entry-cell">${renderTreatmentBox(row)}</td>
      <td class="status-column priority-cell">${priorityBadge(row.prioridade)}</td>
      <td class="nowrap">${formatDate(row.vencimento)}${renderWeekendIndicator(row.vencimento)}</td>
      <td class="num">${days == null ? "-" : escapeHtml(days)}</td>
      <td class="num"><span class="money">${formatCurrency(row.valor)}</span></td>
      <td class="copy-codes-cell">${renderCopyCodeActions(row)}</td>
      <td class="supplier-cell">${escapeHtml(row.fornecedor || "-")}</td>
      <td class="readonly-cell model-cell">${escapeHtml(sourceName(row) || "-")}</td>
      <td class="nowrap">${escapeHtml(row.nf_doc_extraido || "-")}</td>
      <td>${escapeHtml(row.dda_itau || "-")}</td>
      <td class="check-cell readonly-cell">${isChecked(row.checklist) ? "SIM" : "-"}</td>
      <td class="readonly-cell observation-cell" title="${escapeAttr(row.observacao || "")}">${escapeHtml(row.observacao || "-")}</td>
    </tr>
  `;
}

function renderSelect(row, field, options) {
  const current = String(row[field] || "");
  const values = [...new Set([current, ...options].filter(Boolean))];
  const statusClass = field === "tratado_pendente" ? ` treatment-select ${treatmentStatusClass(current)}` : "";
  return `<select class="table-select${statusClass}" data-field="${field}" data-saved-value="${escapeAttr(current)}">${values.map((value) => `<option value="${escapeAttr(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`;
}

function renderTreatmentBox(row) {
  const history = treatmentHistory(row.id);
  const latest = history[0];
  const value = String(latest?.value || "").trim();
  const count = history.length;
  return `
    <div class="treatment-cell-actions">
      <button type="button" class="treatment-box ${value ? "has-treatment" : ""}" data-action="edit-treatment" title="Adicionar nova tratativa" aria-label="Adicionar nova tratativa">
        <span class="treatment-note-icon" aria-hidden="true"></span>
        <span class="treatment-preview">Adicionar tratativa</span>
        ${count ? `<span class="treatment-count-badge" aria-label="${count} tratativa${count === 1 ? "" : "s"}">${count}</span>` : ""}
      </button>
      ${count ? `<button type="button" class="treatment-view-button" data-action="view-treatment" title="Visualizar historico de tratativas" aria-label="Visualizar ${count} tratativa${count === 1 ? "" : "s"}"><span class="treatment-eye-icon" aria-hidden="true"></span></button>` : ""}
    </div>
  `;
}

function treatmentHistory(rowId) {
  const history = state.treatments.get(String(rowId));
  return Array.isArray(history) ? history : [];
}

function treatmentSearchText(rowId) {
  return treatmentHistory(rowId)
    .map((item) => `${item.value || ""} ${item.changedBy || ""}`)
    .join(" ");
}

function treatmentsForExport(rowId) {
  return treatmentHistory(rowId)
    .slice()
    .reverse()
    .map((item) => `${formatDateTime(item.changedAt)} - ${item.changedBy || "Nao informado"}: ${item.value || ""}`)
    .join(" | ");
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
  const groups = groupBy(state.rows, (row) => sourceName(row) || "Sem fonte");
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
  const viewTreatmentButton = event.target.closest('[data-action="view-treatment"]');
  if (viewTreatmentButton) {
    openTreatmentView(viewTreatmentButton);
    return;
  }

  const treatmentButton = event.target.closest('[data-action="edit-treatment"]');
  if (treatmentButton) {
    openTreatmentDialog(treatmentButton);
    return;
  }

  const copyButton = event.target.closest(".copy-code-button");
  if (copyButton) {
    await copyRowCode(copyButton);
    return;
  }
}

function openTreatmentView(button) {
  const rowId = button.closest("tr[data-id]")?.dataset.id;
  renderTreatmentHistory(rowId);
}

function renderTreatmentHistory(rowId) {
  const row = state.allRows.find((item) => item.id === rowId);
  const history = treatmentHistory(rowId);
  if (!row || !history.length) return;
  refs.treatmentViewDialog.dataset.rowId = rowId;
  refs.treatmentViewContext.textContent = `${row.fornecedor || "Fornecedor nao informado"} | ${formatCurrency(row.valor)} | ${formatDate(row.vencimento)}`;
  refs.treatmentViewList.innerHTML = history.map((treatment, index) => `
    <article class="treatment-history-card" data-audit-id="${escapeAttr(treatment.auditId || "")}">
      <header>
        <strong>${escapeHtml(treatment.changedBy || "Nao informado")}</strong>
        <span>${escapeHtml(formatDateTime(treatment.changedAt))}</span>
      </header>
      <p>${escapeHtml(treatment.value || "")}</p>
      <div class="treatment-history-footer">
        <small>Tratativa ${history.length - index}</small>
        ${state.role === "admin" && treatment.auditId ? '<button type="button" class="treatment-delete-button" data-action="delete-treatment">Excluir</button>' : ""}
      </div>
    </article>
  `).join("");
  if (!refs.treatmentViewDialog.open) refs.treatmentViewDialog.showModal();
}

async function handleTreatmentHistoryClick(event) {
  const button = event.target.closest('[data-action="delete-treatment"]');
  if (!button) return;
  if (state.role !== "admin" || !isAuthorizedAdmin(state.user)) {
    toast("Somente o administrador pode excluir tratativas.");
    return;
  }

  const card = button.closest("[data-audit-id]");
  const auditId = card?.dataset.auditId;
  const rowId = refs.treatmentViewDialog.dataset.rowId;
  if (!auditId || !rowId) {
    toast("Nao foi possivel identificar a tratativa.");
    return;
  }

  if (!window.confirm("Excluir esta tratativa? Esta acao nao pode ser desfeita.")) return;

  button.disabled = true;
  try {
    const { data: deleted, error } = await supabase.rpc("delete_boleto_pendentes_tratativa", { p_audit_id: auditId });
    if (error) throw error;
    if (deleted !== true) throw new Error("Tratativa nao encontrada ou ja excluida.");

    await loadTreatments();
    if (treatmentHistory(rowId).some((treatment) => treatment.auditId === auditId)) {
      throw new Error("A exclusao nao foi confirmada pelo servidor.");
    }

    applyFilters();
    if (treatmentHistory(rowId).length) {
      renderTreatmentHistory(rowId);
    } else {
      refs.treatmentViewDialog.close();
      refs.treatmentViewDialog.dataset.rowId = "";
    }
    toast("Tratativa excluida.");
  } catch (error) {
    const message = String(error?.code || "") === "42501"
      ? "Exclusao negada: somente o administrador autorizado pode excluir tratativas."
      : error?.message || "Nao foi possivel excluir a tratativa.";
    toast(message);
    button.disabled = false;
  }
}

function openTreatmentDialog(button) {
  const rowId = button.closest("tr[data-id]")?.dataset.id;
  const row = state.allRows.find((item) => item.id === rowId);
  if (!row) return;
  refs.treatmentDialog.dataset.rowId = rowId;
  refs.treatmentText.value = "";
  refs.treatmentContext.textContent = `${row.fornecedor || "Fornecedor nao informado"} | ${formatCurrency(row.valor)} | ${formatDate(row.vencimento)}`;
  refs.treatmentDialog.showModal();
  refs.treatmentText.focus();
}

function closeTreatmentDialog() {
  refs.treatmentDialog.close();
  refs.treatmentDialog.dataset.rowId = "";
  refs.treatmentText.value = "";
}

async function saveTreatment(event) {
  event.preventDefault();
  const rowId = refs.treatmentDialog.dataset.rowId;
  const row = state.allRows.find((item) => item.id === rowId);
  if (!row) return;

  const value = refs.treatmentText.value.trim();
  if (!value) {
    toast("Informe a tratativa.");
    refs.treatmentText.focus();
    return;
  }

  const history = treatmentHistory(rowId);
  const previous = history[0] || null;
  const changedBy = currentOperatorName();
  const changedAt = new Date().toISOString();
  refs.treatmentSaveButton.disabled = true;
  try {
    const payload = { field: "tratativa", value, ...authenticatedAuditIdentity(), changed_at: changedAt, source: "painel_web" };
    const { error: auditError } = await supabase.from(AUDIT_TABLE).insert({
      item_id: rowId,
      field_name: "tratativa",
      old_value: previous,
      new_value: { action: "tratativa_insert", payload },
    });
    if (auditError) throw auditError;

    await loadTreatments();

    const { data, error } = await supabase
      .from(ITEMS_TABLE)
      .update({ last_changed_by: changedBy, last_changed_at: changedAt })
      .eq("id", rowId)
      .select("*")
      .single();
    if (!error && data) Object.assign(row, data);
    closeTreatmentDialog();
    applyFilters();
    toast(error ? "Tratativa salva; metadados nao atualizados." : "Tratativa salva.");
  } catch (error) {
    toast(error.message || "Nao foi possivel salvar a tratativa.");
  } finally {
    refs.treatmentSaveButton.disabled = false;
  }
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
  if (input.dataset.saving === "1" || state.savingRows.has(id)) return;
  if (String(value) === String(row[field] || "") && input.dataset.savedValue === String(value)) return;
  const previous = {
    [field]: row[field],
    last_changed_by: row.last_changed_by,
    last_changed_at: row.last_changed_at,
  };
  const changedBy = currentOperatorName();
  const changedAt = new Date().toISOString();
  state.savingRows.add(id);
  input.dataset.saving = "1";
  state.suppressRealtimeUntil = Date.now() + 5000;
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
    input.dataset.savedValue = String(input.value);
    await recordAudit(id, "painel_update", { field, value, ...authenticatedAuditIdentity(), changed_at: changedAt, source: "painel_web" }, previous);
    toast("Alteracao salva.");
    applyFilters();
  } catch (error) {
    input.value = String(previous[field] || "");
    input.dataset.savedValue = String(previous[field] || "");
    toast(error.message || "Nao foi possivel salvar.");
  } finally {
    state.savingRows.delete(id);
    delete input.dataset.saving;
    input.disabled = false;
  }
}

async function recordAudit(itemId, action, payload, oldValue = null) {
  const { error } = await supabase.from(AUDIT_TABLE).insert({
    item_id: itemId,
    field_name: payload.field || action,
    old_value: oldValue,
    new_value: { action, payload },
  });
  if (error) throw error;
}

function currentOperatorName() {
  return authenticatedDisplayName();
}

function activateTab(tab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tab}Tab`);
  });
  document.body.classList.toggle("boletos-mode", tab === "boletos");
  document.body.classList.toggle("overview-mode", tab === "overview");
}

function exportCsv() {
  const headers = ["tratado_pendente", "last_changed_by", "last_changed_at", "tratativa", "prioridade", "vencimento", "dias_para_vencer", "valor", "fornecedor", "fonte", "nf_doc_extraido", "dda_itau", "checklist", "observacao"];
  const lines = [headers.join(";")].concat(state.rows.map((row) => headers.map((field) => {
    const value = field === "dias_para_vencer"
      ? daysUntilDue(row.vencimento)
      : field === "tratativa"
        ? treatmentsForExport(row.id)
        : field === "fonte"
          ? sourceName(row)
          : row[field];
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
  const text = String(value ?? "");
  const formulaProbe = text.replace(/^[\s\u0000-\u001f]+/, "");
  const safeText = typeof value === "string" && /^[=+\-@]/.test(formulaProbe) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
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
