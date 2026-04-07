const API_BASE = "/api";
const LOGS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_INTERVAL_MS = 3000;
const DUMMY_STATUS_URL = "/mocks/dummy_status.json";

const TEST_CHART_URL = "/assets/test_chart.png";
const TEST_MODEL_URL = "/assets/dummy.pt";

const state = {
  dashboard: null,
  datasets: [],
  runs: [],
  datasetDetails: {},
  runDetails: {},
  activeDatasetId: null,
  activeRunId: null,
  compareDatasetId: null,
  compareRunIds: [],
  runTab: "overview",
  dummyStatus: {
    modelNumber: "—",
    totalCount: "—",
    status: "unknown",
  },
  trainingMonitor: {
    visible: false,
    runId: null,
    statusText: "Ожидание запуска...",
    logs: "",
    pollingInterval: null,
  }
};

let stopLogsPolling = null;
let stopStatusPolling = null;

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return num.toFixed(digits);
}

function metricValue(value, digits = 2) {
  return formatNumber(value, digits);
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (["finished", "ready", "completed"].includes(value)) return "finished";
  if (value === "running") return "running";
  if (value === "queued") return "queued";
  if (value === "failed") return "failed";
  return "running";
}

function setPageMeta(title, subtitle) {
  const titleEl = qs("#page-title");
  const subtitleEl = qs("#page-subtitle");
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function showNotice(message, type = "info") {
  const el = qs("#app-notice");
  if (!el) return;
  el.innerHTML = `<div class="notice ${type}">${escapeHtml(message)}</div>`;
}

function clearNotice() {
  const el = qs("#app-notice");
  if (el) el.innerHTML = "";
}

function setLoading(message = "Загрузка...") {
  const root = qs("#app-root");
  if (root) {
    root.innerHTML = `<div class="loader">${escapeHtml(message)}</div>`;
  }
}

function cleanupSideEffects() {
  if (typeof stopLogsPolling === "function") {
    stopLogsPolling();
    stopLogsPolling = null;
  }

  if (typeof stopStatusPolling === "function") {
    stopStatusPolling();
    stopStatusPolling = null;
  }
}

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const init = {
    method: options.method || "GET",
    headers: {
      Accept: options.asText ? "text/plain" : "application/json",
      ...(options.headers || {}),
    },
  };

  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    let payloadText = "";
    try {
      payloadText = await response.text();
    } catch {
      payloadText = "";
    }

    let errorMessage = payloadText || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(payloadText);
      if (parsed?.detail) errorMessage = parsed.detail;
    } catch {
      // noop
    }

    throw new Error(errorMessage);
  }

  if (options.asText) {
    return response.text();
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

async function refreshCoreData() {
  const [dashboard, datasets, runs] = await Promise.all([
    api("/dashboard"),
    api("/datasets"),
    api("/runs"),
  ]);

  state.dashboard = dashboard || {};
  state.datasets = ensureArray(datasets);
  state.runs = ensureArray(runs);

  if (!state.activeDatasetId && state.datasets.length) {
    state.activeDatasetId = state.datasets[0].id;
  }

  if (!state.compareDatasetId && state.datasets.length) {
    state.compareDatasetId = state.datasets[0].id;
  }

  if (!state.activeRunId && state.runs.length) {
    state.activeRunId = state.runs[0].id;
  }

  if (
    state.activeDatasetId &&
    !state.datasets.some((dataset) => String(dataset.id) === String(state.activeDatasetId))
  ) {
    state.activeDatasetId = state.datasets[0]?.id || null;
  }

  if (
    state.compareDatasetId &&
    !state.datasets.some((dataset) => String(dataset.id) === String(state.compareDatasetId))
  ) {
    state.compareDatasetId = state.datasets[0]?.id || null;
  }

  if (
    state.activeRunId &&
    !state.runs.some((run) => String(run.id) === String(state.activeRunId))
  ) {
    state.activeRunId = state.runs[0]?.id || null;
  }
}

async function ensureDatasetDetail(datasetId) {
  if (!datasetId) return null;
  const key = String(datasetId);
  if (state.datasetDetails[key]) return state.datasetDetails[key];
  const data = await api(`/datasets/${key}`);
  state.datasetDetails[key] = data;
  return data;
}

async function ensureRunDetail(runId) {
  if (!runId) return null;
  const key = String(runId);
  if (state.runDetails[key]) return state.runDetails[key];
  const data = await api(`/runs/${key}`);
  state.runDetails[key] = data;
  return data;
}

function getDatasetById(datasetId) {
  return state.datasets.find((item) => String(item.id) === String(datasetId)) || null;
}

function getRunById(runId) {
  return state.runs.find((item) => String(item.id) === String(runId)) || null;
}

function getRunsByDataset(datasetId) {
  return state.runs.filter((run) => String(run.datasetId) === String(datasetId));
}

function parseRoute() {
  const hash = (window.location.hash || "#dashboard").replace(/^#/, "");
  const [section, id] = hash.split("/");

  if (section === "runs" && id) {
    return { name: "run-detail", id };
  }

  return { name: section || "dashboard" };
}

function setActiveNav(routeName) {
  qsa(".nav-link").forEach((link) => {
    const key = link.dataset.route;
    const active = routeName === "run-detail" ? key === "runs" : key === routeName;
    link.classList.toggle("active", active);
  });
}

function renderStatus(status) {
  const value = String(status || "").toLowerCase();
  return `<span class="status ${statusClass(value)}">${escapeHtml(value || "unknown")}</span>`;
}

function renderKpi(label, value, note = "") {
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(value)}</div>
      <div class="kpi-note">${escapeHtml(note)}</div>
    </div>
  `;
}

function renderRoot(html) {
  cleanupSideEffects();
  const root = qs("#app-root");
  if (root) root.innerHTML = html;
}

function sparkline(points, height = 110) {
  if (!Array.isArray(points) || !points.length) {
    return `
      <svg class="chart-svg" viewBox="0 0 240 ${height}" preserveAspectRatio="none">
        <line class="chart-grid-line" x1="0" y1="${height - 1}" x2="240" y2="${height - 1}"></line>
      </svg>
    `;
  }

  const width = 240;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const normalized = points.map((value, index) => {
    const x = index * step;
    const y = height - 12 - ((value - min) / range) * (height - 24);
    return { x, y };
  });

  const linePoints = normalized.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPoints = `0,${height - 2} ${linePoints} ${width},${height - 2}`;

  return `
    <svg class="chart-svg" viewBox="0 0 240 ${height}" preserveAspectRatio="none">
      <line class="chart-grid-line" x1="0" y1="${height - 1}" x2="240" y2="${height - 1}"></line>
      <polygon class="chart-area" points="${areaPoints}"></polygon>
      <polyline class="chart-line" points="${linePoints}"></polyline>
      ${normalized.map((p) => `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="3"></circle>`).join("")}
    </svg>
  `;
}

function getDashboardSummary() {
  const summary = state.dashboard?.summary || {};
  return {
    datasetsCount: summary.datasetsCount ?? state.datasets.length ?? 0,
    runsCount: summary.runsCount ?? state.runs.length ?? 0,
    runningCount:
      summary.runningCount ??
      state.runs.filter((run) => String(run.status).toLowerCase() === "running").length,
    queuedCount:
      summary.queuedCount ??
      state.runs.filter((run) => String(run.status).toLowerCase() === "queued").length,
  };
}

function optionMarkup(values, selectedValue) {
  return values
    .map((value) => {
      const item = typeof value === "string" ? { value, label: value } : value;
      const selected = String(item.value) === String(selectedValue) ? "selected" : "";
      return `<option value="${escapeHtml(item.value)}" ${selected}>${escapeHtml(item.label)}</option>`;
    })
    .join("");
}

function serializeForm(form) {
  const formData = new FormData(form);
  const output = {};
  for (const [key, value] of formData.entries()) {
    output[key] = value;
  }
  return output;
}

function formToJSON(form) {
  const data = {};
  const processedCheckboxGroups = new Set();

  const elements = Array.from(form.elements).filter((el) => {
    return el.name && !el.disabled && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
  });

  for (const el of elements) {
    const name = el.name;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || "").toLowerCase();

    if (type === "radio") {
      if (!el.checked) continue;
      setValue(data, name, el.value);
      continue;
    }

    if (type === "checkbox") {
      const selectorName = escapeForSelector(name);
      const group = form.querySelectorAll(`input[type="checkbox"][name="${selectorName}"]`);

      if (group.length > 1) {
        if (processedCheckboxGroups.has(name)) continue;
        processedCheckboxGroups.add(name);

        const checkedValues = Array.from(group)
          .filter((c) => c.checked)
          .map((c) => c.value);

        data[name] = checkedValues;
      } else {
        setValue(data, name, !!el.checked);
      }
      continue;
    }

    if (tag === "select" && el.multiple) {
      const values = Array.from(el.selectedOptions).map((opt) => opt.value);
      setValue(data, name, values);
      continue;
    }

    if (type === "file") {
      const files = el.files ? Array.from(el.files).map((f) => f.name) : [];
      setValue(data, name, el.multiple ? files : files[0] ?? "");
      continue;
    }

    if (type === "number" || type === "range") {
      const v = el.value;
      setValue(data, name, v === "" ? "" : Number(v));
      continue;
    }

    setValue(data, name, el.value);
  }

  return data;
}

function setValue(obj, key, value) {
  if (obj[key] === undefined) {
    obj[key] = value;
    return;
  }

  if (Array.isArray(obj[key])) {
    obj[key] = Array.isArray(value) ? obj[key].concat(value) : obj[key].concat([value]);
    return;
  }

  obj[key] = Array.isArray(value) ? [obj[key], ...value] : [obj[key], value];
}

function escapeForSelector(name) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(name);
  return String(name).replace(/"/g, '\\"');
}

async function fetchLogs(url) {
  const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function renderLogsWithAutoscroll(textarea, text) {
  textarea.value = text;
  textarea.scrollTop = textarea.scrollHeight;
}

function startLogsPolling(opts) {
  const {
    textareaId,
    statusId,
    url,
    intervalMs = LOGS_POLL_INTERVAL_MS,
  } = opts;

  const textarea = document.getElementById(textareaId);
  const statusEl = statusId ? document.getElementById(statusId) : null;

  if (!textarea) {
    return () => {};
  }

  let lastText = null;
  let timerId = null;

  const tick = async () => {
    try {
      if (statusEl) statusEl.textContent = "Загрузка логов...";
      const text = await fetchLogs(url);

      if (text !== lastText) {
        renderLogsWithAutoscroll(textarea, text);
        lastText = text;
      }

      if (statusEl) {
        statusEl.textContent = `Обновлено: ${new Date().toLocaleTimeString()}`;
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `Ошибка: ${error.message}`;
      }
    }
  };

  tick();
  timerId = setInterval(tick, intervalMs);

  return () => {
    if (timerId) clearInterval(timerId);
  };
}

function normalizeDummyStatus(payload = {}) {
  return {
    modelNumber: payload.modelNumber ?? payload.model_number ?? payload.model ?? "—",
    totalCount: payload.totalCount ?? payload.total_count ?? payload.total ?? "—",
    status: payload.status ?? "unknown",
  };
}

async function fetchDummyStatus() {
  const url = `${DUMMY_STATUS_URL}${DUMMY_STATUS_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return normalizeDummyStatus(data);
}

function renderDummyStatusCard() {
  const data = normalizeDummyStatus(state.dummyStatus);

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Статус модели</h2>
          <p class="card-subtitle">Обновление каждые 3 секунды из dummy_status.json</p>
        </div>
      </div>

      <div class="grid-4">
        <div class="kpi">
          <div class="kpi-label">Номер модели</div>
          <div class="kpi-value" id="dummyStatusModel">${escapeHtml(String(data.modelNumber))}</div>
          <div class="kpi-note">Источник: dummy_status.json</div>
        </div>

        <div class="kpi">
          <div class="kpi-label">Общее количество</div>
          <div class="kpi-value" id="dummyStatusTotal">${escapeHtml(String(data.totalCount))}</div>
          <div class="kpi-note">Текущее значение</div>
        </div>

        <div class="kpi">
          <div class="kpi-label">Статус</div>
          <div class="kpi-value" id="dummyStatusValue">${renderStatus(data.status)}</div>
          <div class="kpi-note" id="dummyStatusUpdated">Ожидание обновления...</div>
        </div>
      </div>
    </section>
  `;
}

function applyDummyStatus(data) {
  const normalized = normalizeDummyStatus(data);
  state.dummyStatus = normalized;

  const modelEl = qs("#dummyStatusModel");
  const totalEl = qs("#dummyStatusTotal");
  const statusEl = qs("#dummyStatusValue");
  const updatedEl = qs("#dummyStatusUpdated");

  if (modelEl) modelEl.textContent = String(normalized.modelNumber);
  if (totalEl) totalEl.textContent = String(normalized.totalCount);
  if (statusEl) statusEl.innerHTML = renderStatus(normalized.status);

  if (updatedEl) {
    updatedEl.textContent = `Обновлено: ${new Date().toLocaleTimeString("ru-RU")}`;
  }
}

function startDummyStatusPolling() {
  let timerId = null;

  const tick = async () => {
    try {
      const data = await fetchDummyStatus();
      applyDummyStatus(data);
    } catch (error) {
      const updatedEl = qs("#dummyStatusUpdated");
      if (updatedEl) {
        updatedEl.textContent = `Ошибка: ${error.message}`;
      }
    }
  };

  tick();
  timerId = setInterval(tick, STATUS_POLL_INTERVAL_MS);

  return () => {
    if (timerId) clearInterval(timerId);
  };
}
function renderTrainingMonitorBlock() {
  const monitor = state.trainingMonitor || {};
  const hiddenAttr = monitor.visible ? "" : "hidden";

  return `
    <article class="run-summary-card" id="datasetTrainingMonitor" ${hiddenAttr} style="margin-top:16px;">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">Мониторинг обучения</h3>
          <p class="card-subtitle">Статус запуска и вывод логов</p>
        </div>
      </div>

      <div id="datasetTrainingLogsStatus" class="logs-status">${escapeHtml(
        monitor.statusText || "Ожидание запуска..."
      )}</div>

      <textarea
        id="datasetTrainingLogsTextarea"
        class="logs-box"
        readonly
        spellcheck="false"
        style="height:220px; min-height:220px; resize:vertical;"
      >${escapeHtml(monitor.logs || "")}</textarea>
    </article>
  `;
}

function setTrainingMonitorVisible(visible) {
  state.trainingMonitor.visible = !!visible;
  const block = qs("#datasetTrainingMonitor");
  if (block) {
    block.hidden = !visible;
  }
}

function setTrainingMonitorStatus(text) {
  state.trainingMonitor.statusText = text;
  const el = qs("#datasetTrainingLogsStatus");
  if (el) {
    el.textContent = text;
  }
}

function setTrainingMonitorLogs(text) {
  state.trainingMonitor.logs = text;
  const textarea = qs("#datasetTrainingLogsTextarea");
  if (textarea) {
    renderLogsWithAutoscroll(textarea, text);
  }
}

function appendTrainingMonitorLog(line) {
  const current = state.trainingMonitor.logs || "";
  const next = current ? `${current}\n${line}` : line;
  setTrainingMonitorLogs(next);
}
function startTrainingMonitorPolling(runId) {
  if (state.trainingMonitor.pollingInterval) {
    clearInterval(state.trainingMonitor.pollingInterval);
  }
  
  const updateLogs = async () => {
    try {
      const logs = await api(`/runs/${runId}/logs`, { asText: true });
      setTrainingMonitorLogs(logs);

      const lastLines = logs.split('\n').slice(-5).join('\n');
      
      if (lastLines.includes('ОБУЧЕНИЕ УСПЕШНО ЗАВЕРШЕНО') || 
          lastLines.includes(' ОБУЧЕНИЕ УСПЕШНО ЗАВЕРШЕНО!')) {
        setTrainingMonitorStatus(' Обучение завершено');

        if (state.trainingMonitor.pollingInterval) {
          clearInterval(state.trainingMonitor.pollingInterval);
          state.trainingMonitor.pollingInterval = null;
        }

        refreshCoreData();
        
      } else if (lastLines.includes('Ошибка')) {
        setTrainingMonitorStatus('Ошибка обучения');

        if (state.trainingMonitor.pollingInterval) {
          clearInterval(state.trainingMonitor.pollingInterval);
          state.trainingMonitor.pollingInterval = null;
        }
        
      } else {
        const lastLine = logs.split('\n').pop();
        if (lastLine && !lastLine.includes('[')) {
          setTrainingMonitorStatus(lastLine);
        } else {
          setTrainingMonitorStatus('Обучение выполняется...');
        }
      }
      
    } catch (error) {
      console.error('Ошибка загрузки логов:', error);
      setTrainingMonitorStatus('Ошибка загрузки логов');
    }
  };
  
  updateLogs();

  state.trainingMonitor.pollingInterval = setInterval(updateLogs, 2000);
}



function trainingMonitorLine(message) {
  return `[${new Date().toLocaleTimeString("ru-RU")}] ${message}`;
}

function mockStartTraining(data) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: "started" }), 1000);
  });
}

function bestCellClass(values, current, lowerIsBetter = false) {
  const numeric = values.map(Number).filter((v) => !Number.isNaN(v));
  if (!numeric.length || Number.isNaN(Number(current))) return "";
  const best = lowerIsBetter ? Math.min(...numeric) : Math.max(...numeric);
  return Number(current) === best ? "best-cell" : "";
}

function getModelMetric(model, key) {
  if (!model) return null;
  if (key === "map") return model.map ?? model.mAP ?? null;
  return model[key] ?? null;
}

function renderDashboardPage() {
  setPageMeta("Dashboard", "Обзор датасетов, запусков и результатов");

  const summary = getDashboardSummary();
  const recentRuns = [...state.runs]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 6);

  const topDatasets = state.dashboard?.topDatasets?.length
    ? state.dashboard.topDatasets
    : state.datasets.slice(0, 6);

  renderRoot(`
    <div class="page-stack">
      <section class="grid-4">
        ${renderKpi("Datasets", String(summary.datasetsCount), "Всего датасетов")}
        ${renderKpi("Runs", String(summary.runsCount), "Всего запусков")}
        ${renderKpi("Running", String(summary.runningCount), "Активные задачи")}
        ${renderKpi("Queued", String(summary.queuedCount), "В очереди")}
      </section>

      ${renderDummyStatusCard()}

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Datasets</h2>
            <p class="card-subtitle">Выберите датасет для запуска и анализа результатов</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-primary" id="goDatasetsButton" type="button">Открыть Datasets</button>
          </div>
        </div>

        ${
          topDatasets.length
            ? `
              <div class="grid-auto">
                ${topDatasets
                  .map(
                    (dataset) => `
                      <article class="dataset-card">
                        <div class="dataset-card-header">
                          <div>
                            <div class="dataset-name">${escapeHtml(dataset.name || "Без названия")}</div>
                            <div class="dataset-meta">

                            </div>
                          </div>
                          ${renderStatus(dataset.status || "ready")}
                        </div>

                        <div class="meta-chips">
                          <span class="chip">Best model: ${escapeHtml(dataset.bestModel || "—")}</span>
                          <span class="chip">Best mAP: ${metricValue(dataset.bestMap, 2)}</span>
                        </div>

                        <div class="form-actions" style="margin-top:14px;">
                          <button class="btn btn-secondary dashboard-dataset-open" data-dataset-id="${escapeHtml(
                            dataset.id
                          )}" type="button">Открыть</button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-state">Датасеты пока не добавлены</div>`
        }
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Latest runs</h2>
            <p class="card-subtitle">История последних запусков</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-secondary" id="goRunsButton" type="button">Открыть Runs</button>
          </div>
        </div>

        ${
          recentRuns.length
            ? `
              <div class="table-wrap">
                <table class="table table-clickable" id="dashboardRunsTable">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Dataset</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Best model</th>
                      <th>mAP</th>
                      <th>Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recentRuns
                      .map(
                        (run) => `
                          <tr data-run-id="${escapeHtml(run.id)}">
                            <td>${escapeHtml(run.id)}</td>
                            <td>${escapeHtml(run.datasetName || "—")}</td>
                            <td>${renderStatus(run.status)}</td>
                            <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                            <td>${escapeHtml(run.bestModel || "—")}</td>
                            <td>${metricValue(run.bestMap, 2)}</td>
                            <td>${escapeHtml(run.device || run.gpu || "—")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Запусков пока нет</div>`
        }
      </section>
    </div>
  `);

  qs("#goDatasetsButton")?.addEventListener("click", () => {
    window.location.hash = "#datasets";
  });

  qs("#goRunsButton")?.addEventListener("click", () => {
    window.location.hash = "#runs";
  });

  qsa(".dashboard-dataset-open").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeDatasetId = button.dataset.datasetId;
      window.location.hash = "#datasets";
    });
  });

  qs("#dashboardRunsTable")?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-run-id]");
    if (!row) return;
    state.activeRunId = row.dataset.runId;
    state.runTab = "overview";
    window.location.hash = `#runs/${row.dataset.runId}`;
  });

  stopStatusPolling = startDummyStatusPolling();
}


function addHyperparamRow() {
  const container = document.getElementById('hyperparamsContainer');
  const newRow = document.createElement('div');
  newRow.className = 'hyperparam-row';  
  const searchAlgSelect = qs("#searchAlg");
  const isRandomSearch = searchAlgSelect && searchAlgSelect.value === "RandomSearch";
  
  newRow.innerHTML = `
    <input type="text" name="hyperparam_name[]" placeholder="Название" class="hyperparam-name" />
    ${isRandomSearch ? `
      <select name="hyperparam_type[]" class="hyperparam-type">
        <option value="list">Список значений</option>
        <option value="range">Диапазон (мин макс)</option>
      </select>
    ` : '<input type="hidden" name="hyperparam_type[]" value="list" />'}
    <input type="text" name="hyperparam_values[]" placeholder="Значения" class="hyperparam-values" />
    <button type="button" class="btn-remove-param" onclick="removeHyperparamRow(this)">✖</button>
  `;
  container.appendChild(newRow);
}

function removeHyperparamRow(button) {
  const row = button.closest('.hyperparam-row');
  if (row && document.querySelectorAll('.hyperparam-row').length > 1) {
    row.remove();
  } else {
    showNotice('Должна остаться хотя бы одна строка', 'warning');
  }
}

function collectHyperparams() {
  const names = document.querySelectorAll('input[name="hyperparam_name[]"]');
  const types = document.querySelectorAll('select[name="hyperparam_type[]"], input[name="hyperparam_type[]"]');
  const values = document.querySelectorAll('input[name="hyperparam_values[]"]');
  const hyperparams = {};
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i].value.trim();
    let type = types[i]?.value || 'list';
    const valuesStr = values[i].value.trim();
    
    if (name && valuesStr) {
      if (type === 'list') {
        const valuesArray = valuesStr.split(/\s+/).map(v => {
          const num = Number(v);
          return isNaN(num) ? v : num;
        });
        hyperparams[name] = {
          type: 'list',
          values: valuesArray
        };
      } else if (type === 'range') {
        const parts = valuesStr.split(/\s+/);
        if (parts.length >= 2) {
          const min = Number(parts[0]);
          const max = Number(parts[1]);
          
          if (!isNaN(min) && !isNaN(max)) {
            hyperparams[name] = {
              type: 'range',
              min: min,
              max: max,
            };
          }
        }
      }
    }
  }
  
  return hyperparams;
}

function toggleHyperparamTypes() {
  const searchAlgSelect = qs("#searchAlg");
  const isRandomSearch = searchAlgSelect && searchAlgSelect.value === "RandomSearch";
  
  // Находим все строки гиперпараметров
  const hyperparamRows = document.querySelectorAll('.hyperparam-row');
  
  hyperparamRows.forEach(row => {
    const existingTypeSelect = row.querySelector('select[name="hyperparam_type[]"]');
    const existingHiddenInput = row.querySelector('input[name="hyperparam_type[]"][type="hidden"]');
    const valuesInput = row.querySelector('input[name="hyperparam_values[]"]');
    
    if (isRandomSearch) {
      if (existingHiddenInput) {
        const select = document.createElement('select');
        select.name = 'hyperparam_type[]';
        select.className = 'hyperparam-type';
        select.innerHTML = `
          <option value="list">Список значений</option>
          <option value="range">Диапазон (мин макс)</option>
        `;
        existingHiddenInput.replaceWith(select);
      } else if (existingTypeSelect) {
        existingTypeSelect.style.display = 'block';
      }
      
      if (valuesInput) {
        const typeSelect = row.querySelector('select[name="hyperparam_type[]"]');
        if (typeSelect) {
          const currentType = typeSelect.value;
          valuesInput.placeholder = currentType === 'list' ? 'Значения: 0.001 0.01 0.1' : 'Диапазон: 0.001 0.1';
          
          typeSelect.onchange = () => {
            valuesInput.placeholder = typeSelect.value === 'list' 
              ? 'Значения: 0.001 0.01 0.1' 
              : 'Диапазон: 0.001 0.1';
          };
        }
      }
    } else {
      if (existingTypeSelect) {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'hyperparam_type[]';
        hiddenInput.value = 'list';
        existingTypeSelect.replaceWith(hiddenInput);
      }
      if (valuesInput) {
        valuesInput.placeholder = 'Значения: 0.001 0.01 0.1';
      }
    }
  });
}

async function renderDatasetsPage() {
  setPageMeta("Datasets", "Загрузка датасетов и запуск AutoML");

  const activeId = state.activeDatasetId || state.datasets[0]?.id || null;
  state.activeDatasetId = activeId;

  const datasetDetail = activeId ? await ensureDatasetDetail(activeId) : null;
  const datasetRuns = activeId ? getRunsByDataset(activeId).slice(0, 5) : [];
  const yamlReady = Boolean(datasetDetail?.yamlPath);

  renderRoot(`
    <div class="page-stack">
      <section class="grid-2">
        <article class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Новый датасет</h2>
              <p class="card-subtitle">Загрузите архив или конфигурацию датасета</p>
            </div>
          </div>

          <form id="datasetUploadForm">
            <div class="form-grid">
              <div class="form-group">
                <label for="displayName">Название</label>
                <input id="displayName" name="displayName" type="text" required />
              </div>
            </div>

            <div class="form-group">
              <label for="description">Описание</label>
              <textarea id="description" name="description"></textarea>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label for="numClasses">Classes Count</label>
                <input id="numClasses" name="numClasses" type="number" min="1" placeholder="3" />
              </div>

              <div class="form-group">
                <label for="classNames">Class Names</label>
                <input id="classNames" name="classNames" type="text" placeholder="person, car, ball" />
              </div>
            </div>

            <div class="helper-text">
              For archives these values are used to create <code>data.yaml</code>. If you upload an existing
              YAML file, the values will be read automatically.
            </div>

            <div class="form-group">
              <label for="datasetFile">Файл датасета</label>
              <input id="datasetFile" name="datasetFile" type="file" accept=".zip,.yaml,.yml,.json" required  />
            </div>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit">Загрузить датасет</button>
            </div>
          </form>
        </article>

        <article class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Список датасетов</h2>
              <p class="card-subtitle">Выберите датасет для работы</p>
            </div>
          </div>

          ${
            state.datasets.length
              ? `
                <div class="stack">
                  ${state.datasets
                    .map(
                      (dataset) => `
                        <article class="dataset-card">
                          <div class="dataset-card-header">
                            <div>
                              <div class="dataset-name">${escapeHtml(dataset.name || "Без названия")}</div>
                              <div class="dataset-meta">

                              </div>
                            </div>
                            ${renderStatus(dataset.status || "ready")}
                          </div>

                          <div class="meta-chips">
                            <span class="chip">Best model: ${escapeHtml(dataset.bestModel || "—")}</span>
                            <span class="chip">Best mAP: ${metricValue(dataset.bestMap, 2)}</span>
                            <span class="chip">Last run: ${escapeHtml(formatDateTime(dataset.lastRunAt))}</span>
                          </div>

                          <div class="form-actions" style="margin-top:14px;">
                            <button class="btn btn-secondary dataset-switch-btn" type="button" data-dataset-id="${escapeHtml(
                              dataset.id
                            )}">Выбрать</button>
                          </div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              `
              : `<div class="empty-state">Датасеты ещё не добавлены</div>`
          }
        </article>
      </section>

      ${
        datasetDetail
          ? `
            <section class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">${escapeHtml(datasetDetail.name || "Dataset")}</h2>
                  <p class="card-subtitle">${escapeHtml(datasetDetail.description || "Без описания")}</p>
                </div>
                ${renderStatus(datasetDetail.status || "ready")}
              </div>

              <div class="grid-4" style="margin-bottom:16px;">
                ${renderKpi("Samples", escapeHtml(String(datasetDetail.samples ?? "—")), "Размер датасета")}
                ${renderKpi("Classes", escapeHtml(String(datasetDetail.classesCount ?? datasetDetail.classes?.length ?? "—")), "Количество классов")}
                ${renderKpi("Best model", escapeHtml(datasetDetail.bestModel || "—"), "Лучшая модель")}
                ${renderKpi("Best mAP", metricValue(datasetDetail.bestMap, 2), "Лучший результат")}
              </div>

              <div class="grid-2">
                <article class="run-summary-card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title" style="font-size:20px;">Запуск AutoML</h3>
                      <p class="card-subtitle">Настройка запуска для выбранного датасета</p>
                    </div>
                  </div>

                  ${
                    yamlReady
                      ? `
                        <div class="form-group" style="margin-bottom:16px;">
                          <label>Dataset YAML</label>
                          <input type="text" value="${escapeHtml(datasetDetail.yamlPath || "")}" readonly />
                        </div>
                        <div class="form-actions" style="margin-bottom:12px;">
                          <a
                            class="btn btn-secondary"
                            href="${API_BASE}/datasets/${encodeURIComponent(datasetDetail.id)}/yaml"
                            download="data.yaml"
                          >Download data.yaml</a>
                        </div>
                        <textarea
                          class="logs-box"
                          readonly
                          spellcheck="false"
                          style="height:220px; min-height:220px; margin-bottom:16px;"
                        >${escapeHtml(datasetDetail.yamlContent || "")}</textarea>
                      `
                      : `
                        <div class="notice warning" style="margin-bottom:16px;">
                          data.yaml is not configured yet. Open Settings, fill in classes and dataset folders,
                          then save to generate YAML for training.
                        </div>
                      `
                  }

                  <form id="launchRunForm">
                    <div class="form-grid">
                      <div class="form-group">
                        <label for="targetMetric">Целевая метрика</label>
                        <select id="targetMetric" name="targetMetric" ${datasetDetail.availableMetrics?.length ? "" : "disabled"}>
                          ${
                            datasetDetail.availableMetrics?.length
                              ? optionMarkup(
                                  datasetDetail.availableMetrics.map((value) => ({ value, label: value })),
                                  datasetDetail.settings?.targetMetric
                                )
                              : `<option value="">Нет доступных метрик</option>`
                          }
                        </select>
                      </div>

                      <div class="form-group">
                        <label for="device">Устройство</label>
                        <select id="device" name="device">
                          ${optionMarkup(
                            (datasetDetail.availableDevices?.length
                              ? datasetDetail.availableDevices
                              : ["auto", "gpu0", "gpu1", "cpu"]
                            ).map((value) => ({ value, label: value.toUpperCase() })),
                            datasetDetail.settings?.device || "auto"
                          )}
                        </select>
                      </div>
                    </div>

                    <div class="form-grid">


                      <div class="form-group">
                        <label for="runNotes">Комментарий</label>
                        <input id="runNotes" name="notes" type="text" placeholder="Необязательно" />
                      </div>
                    </div>

                    <div class="form-group">
                      <label for="searchAlg">Алгоритм Поиска</label>
                      <select id="searchAlg" name="searchAlg">
                        ${optionMarkup(
                          (datasetDetail.searchAlgorithm?.length
                            ? datasetDetail.searchAlgorithm
                            : ["GridSearch", "RandomSearch"]
                          ).map((value) => ({ value, label: value.toUpperCase() })),
                          datasetDetail.settings?.searchAlgorithm || "GridSearch"
                        )}
                        </select>
                      </div>
                      <div class="form-group" id="randomSearchIterationsGroup" style="display: none;">
                        <label for="randomSearchIterations">Количество комбинаций (RandomSearch)</label>
                        <input type="number" id="randomSearchIterations" name="randomSearchIterations" min="1" max="1000" value="10" step="1"
                          class="form-control"
                        />
                        <small class="form-text text-muted">Количество случайных комбинаций гиперпараметров (1-1000)</small>
                      </div>

                      <div class="form-group">
                        <label>Гиперпараметры</label>
                        <div id="hyperparamsContainer">
                          <div class="hyperparam-row">
                            <input type="text" name="hyperparam_name[]" placeholder="Название" class="hyperparam-name" />
                            <!-- select будет заменен на hidden в зависимости от алгоритма -->
                            <select name="hyperparam_type[]" class="hyperparam-type">
                              <option value="list">Список значений</option>
                              <option value="range">Диапазон (мин макс)</option>
                            </select>
                            <input type="text" name="hyperparam_values[]" placeholder="Значения: 0.001 0.01 0.1" class="hyperparam-values" />
                            <button type="button" class="btn-remove-param" onclick="removeHyperparamRow(this)">✖</button>
                          </div>
                        </div>
                        <button type="button" id="addHyperparamBtn" class="btn-add-param">+ Добавить гиперпараметр</button>
                      </div>
                    <div class="form-actions">
                      <button class="btn btn-primary" type="submit" ${yamlReady ? "" : "disabled"}>
                        Запустить AutoML
                      </button>
                    </div>
                  </form>
                  ${renderTrainingMonitorBlock()}
                </article>

                <article class="run-summary-card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title" style="font-size:20px;">Лучшие модели</h3>
                      <p class="card-subtitle">Результаты по выбранному датасету</p>
                    </div>
                  </div>

                  ${
                    datasetDetail.bestModels?.length
                      ? `
                        <div class="table-wrap">
                          <table class="table">
                            <thead>
                              <tr>
                                <th>Model</th>
                                <th>mAP</th>
                                <th>FPS</th>
                                <th>Size</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${datasetDetail.bestModels
                                .map(
                                  (model) => `
                                    <tr>
                                      <td><strong>${escapeHtml(model.name)}</strong></td>
                                      <td>${metricValue(model.map ?? model.mAP, 2)}</td>
                                      <td>${metricValue(model.fps, 0)}</td>
                                      <td>${metricValue(model.sizeMb, 0)} MB</td>
                                    </tr>
                                  `
                                )
                                .join("")}
                            </tbody>
                          </table>
                        </div>
                      `
                      : `<div class="empty-state">По датасету пока нет обученных моделей.</div>`
                  }
                </article>
              </div>

              <article class="run-summary-card" style="margin-top:16px;">
                <div class="card-header">
                  <div>
                    <h3 class="card-title" style="font-size:20px;">Последние запуски по датасету</h3>
                    <p class="card-subtitle">Переход к деталям запуска</p>
                  </div>
                </div>

                ${
                  datasetRuns.length
                    ? `
                      <div class="table-wrap">
                        <table class="table table-clickable" id="datasetRunsTable">
                          <thead>
                            <tr>
                              <th>Run</th>
                              <th>Status</th>
                              <th>Started</th>
                              <th>Best model</th>
                              <th>mAP</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${datasetRuns
                              .map(
                                (run) => `
                                  <tr data-run-id="${escapeHtml(run.id)}">
                                    <td>${escapeHtml(run.id)}</td>
                                    <td>${renderStatus(run.status)}</td>
                                    <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                                    <td>${escapeHtml(run.bestModel || "—")}</td>
                                    <td>${metricValue(run.bestMap, 2)}</td>
                                  </tr>
                                `
                              )
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    `
                    : `<div class="empty-state">По этому датасету ещё нет запусков</div>`
                }
              </article>
            </section>
          `
          : `
            <section class="card">
              <div class="empty-state">Выберите датасет или загрузите новый</div>
            </section>
          `
      }
    </div>
  `);

  qs("#datasetUploadForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNotice();

    const form = event.currentTarget;
    const submitButton = qs('button[type="submit"]', form);
    if (submitButton) submitButton.disabled = true;

    try {
      const formData = new FormData(form);
      const created = await api("/datasets", {
        method: "POST",
        body: formData,
      });

      state.datasetDetails = {};
      await refreshCoreData();
      state.activeDatasetId = created?.id || state.datasets[0]?.id || null;
      showNotice(
        created?.yamlReady
          ? "Датасет загружен, data.yaml настроен."
          : "Датасет загружен. data.yaml пока не настроен.",
        created?.yamlReady ? "success" : "warning"
      );
      await renderDatasetsPage();
    } catch (error) {
      showNotice(error.message || "Не удалось загрузить датасет.", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  qsa(".dataset-switch-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeDatasetId = button.dataset.datasetId;
      await renderDatasetsPage();
    });
  });

  qs("#launchRunForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();

  const form = event.currentTarget;
  const button = qs('button[type="submit"]', form);
  if (button) button.disabled = true;

  setTrainingMonitorVisible(true);
  state.trainingMonitor.runId = null;
  setTrainingMonitorStatus("Подготовка запуска...");
  setTrainingMonitorLogs("");
  appendTrainingMonitorLog(trainingMonitorLine("Подготовка параметров запуска"));

  try {
    if (!datasetDetail?.yamlPath) {
      throw new Error("Dataset YAML is not configured. Open Settings and save classes/folders first.");
    }

    const payload = serializeForm(form);

    const hyperparams = collectHyperparams();
    if (Object.keys(hyperparams).length > 0) {
      payload.hyperparams = hyperparams;
      appendTrainingMonitorLog(trainingMonitorLine(`Добавлено ${Object.keys(hyperparams).length} гиперпараметров`));
    }
    if (payload.searchAlg === "RandomSearch") {
      const iterations = payload.randomSearchIterations || 10;
      payload.randomSearchIterations = iterations;
      appendTrainingMonitorLog(trainingMonitorLine(`RandomSearch: будет сгенерировано ${iterations} комбинаций`));
    }
    appendTrainingMonitorLog(trainingMonitorLine("Отправка запроса на запуск обучения"));

    const response = await api(`/datasets/${state.activeDatasetId}/runs`, {
      method: "POST",
      body: payload,
    });

    state.runDetails = {};
    await refreshCoreData();

    const runId =
      response?.runId ||
      response?.id ||
      getRunsByDataset(state.activeDatasetId)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0]?.id;

    if (!runId) {
      setTrainingMonitorStatus("Запуск создан, но id не вернулся.");
      appendTrainingMonitorLog(trainingMonitorLine("Не удалось определить id запуска"));
      showNotice("Запуск создан, но id не вернулся.", "warning");
      return;
    }

    state.activeRunId = runId;
    state.runTab = "overview";
    state.trainingMonitor.runId = runId;

    setTrainingMonitorStatus("Запуск создан");
    appendTrainingMonitorLog(trainingMonitorLine(`Запуск создан: ${runId}`));
    showNotice("Обучение запущено.", "success");

    window.location.hash = `#runs/${runId}`;
  } catch (error) {
    const message = error.message || "Не удалось запустить AutoML";
    setTrainingMonitorStatus(`Ошибка: ${message}`);
    appendTrainingMonitorLog(trainingMonitorLine(`Ошибка запуска: ${message}`));
    showNotice(message, "error");
  } finally {
    if (button) button.disabled = false;
  }
  });

  qs("#datasetRunsTable")?.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-run-id]");
  if (!row) return;
  state.activeRunId = row.dataset.runId;
  state.runTab = "overview";
  window.location.hash = `#runs/${row.dataset.runId}`;
  });

  const searchAlgSelect = qs("#searchAlg");
  const iterationsGroup = qs("#randomSearchIterationsGroup");

  function toggleIterationsField() {
    if (searchAlgSelect && iterationsGroup) {
      const isRandomSearch = searchAlgSelect.value === "RandomSearch";
      iterationsGroup.style.display = isRandomSearch ? "block" : "none";
      toggleHyperparamTypes();
    }
  }

  if (searchAlgSelect) {
    searchAlgSelect.addEventListener("change", toggleIterationsField);
    toggleIterationsField(); 
  }

  const addBtn = qs("#addHyperparamBtn");
  if (addBtn) {
    addBtn.removeEventListener("click", addHyperparamRow);
    addBtn.addEventListener("click", () => {
      addHyperparamRow();
      toggleHyperparamTypes();
    });
  }
}

function renderRunsPage() {
  setPageMeta("Runs", "История запусков");

  const sortedRuns = [...state.runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Все запуски</h2>
            <p class="card-subtitle">Фильтрация и переход к деталям</p>
          </div>
        </div>

        <div class="filters">
          <div class="form-group">
            <label for="runsDatasetFilter">Датасет</label>
            <select id="runsDatasetFilter">
              <option value="">Все</option>
              ${state.datasets
                .map(
                  (dataset) =>
                    `<option value="${escapeHtml(dataset.id)}">${escapeHtml(dataset.name)}</option>`
                )
                .join("")}
            </select>
          </div>

          <div class="form-group">
            <label for="runsStatusFilter">Статус</label>
            <select id="runsStatusFilter">
              <option value="">Все</option>
              <option value="running">running</option>
              <option value="finished">finished</option>
              <option value="queued">queued</option>
              <option value="failed">failed</option>
            </select>
          </div>

          <div class="form-group">
            <label for="runsSearch">Поиск</label>
            <input id="runsSearch" type="text" placeholder="run / dataset / model" />
          </div>
        </div>

        ${
          sortedRuns.length
            ? `
              <div class="table-wrap">
                <table class="table table-clickable" id="runsTable">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Dataset</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Finished</th>
                      <th>Best model</th>
                      <th>mAP</th>
                      <th>Device</th>
                      <th>Search Algorithm</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sortedRuns
                      .map(
                        (run) => `
                          <tr
                            data-run-id="${escapeHtml(run.id)}"
                            data-dataset-id="${escapeHtml(run.datasetId)}"
                            data-status="${escapeHtml(String(run.status || "").toLowerCase())}"
                            data-search="${escapeHtml(
                              `${run.id} ${run.datasetName || ""} ${run.bestModel || ""}`.toLowerCase()
                            )}"
                          >
                            <td>${escapeHtml(run.id)}</td>
                            <td>${escapeHtml(run.datasetName || "—")}</td>
                            <td>${renderStatus(run.status)}</td>
                            <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                            <td>${escapeHtml(formatDateTime(run.finishedAt))}</td>
                            <td>${escapeHtml(run.bestModel || "—")}</td>
                            <td>${metricValue(run.bestMap, 2)}</td>
                            <td>${escapeHtml(run.device || run.gpu || "—")}</td>
                            <td>${escapeHtml(run.searchAlgorithm || "—")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Запусков пока нет</div>`
        }
      </section>
    </div>
  `);

  const datasetFilter = qs("#runsDatasetFilter");
  const statusFilter = qs("#runsStatusFilter");
  const searchInput = qs("#runsSearch");
  const table = qs("#runsTable");

  function applyFilters() {
    const datasetValue = datasetFilter?.value || "";
    const statusValue = statusFilter?.value || "";
    const query = (searchInput?.value || "").trim().toLowerCase();

    qsa("tbody tr", table).forEach((row) => {
      const matchDataset = !datasetValue || row.dataset.datasetId === datasetValue;
      const matchStatus = !statusValue || row.dataset.status === statusValue;
      const matchSearch = !query || row.dataset.search.includes(query);
      row.style.display = matchDataset && matchStatus && matchSearch ? "" : "none";
    });
  }

  [datasetFilter, statusFilter, searchInput].forEach((el) => {
    el?.addEventListener("input", applyFilters);
    el?.addEventListener("change", applyFilters);
  });

  table?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-run-id]");
    if (!row) return;
    state.activeRunId = row.dataset.runId;
    state.runTab = "overview";
    window.location.hash = `#runs/${row.dataset.runId}`;
  });
}

function renderRunOverview(detail) {
  const summary = detail.summary || {};
  return `
    <div class="page-stack">
      <section class="grid-4">
        ${renderKpi("Best model", escapeHtml(summary.bestModel || "—"), "Лидер запуска")}
        ${renderKpi("Best mAP", metricValue(summary.bestMap, 2), "Качество")}
        ${renderKpi("Best precision", metricValue(summary.bestPrecision, 2), "Precision")}
        ${renderKpi("Best recall", metricValue(summary.bestRecall, 2), "Recall")}
      </section>

      <section class="grid-2">
        <article class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title" style="font-size:20px;">Сводка запуска</h3>
              <p class="card-subtitle">Основные параметры</p>
            </div>
          </div>

          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr><th>Run</th><td>${escapeHtml(detail.id || "—")}</td></tr>
                <tr><th>Dataset</th><td>${escapeHtml(detail.datasetName || "—")}</td></tr>
                <tr><th>Status</th><td>${renderStatus(detail.status)}</td></tr>
                <tr><th>Started</th><td>${escapeHtml(formatDateTime(detail.startedAt))}</td></tr>
                <tr><th>Finished</th><td>${escapeHtml(formatDateTime(detail.finishedAt))}</td></tr>
                <tr><th>Metric</th><td>${escapeHtml(detail.targetMetric || "—")}</td></tr>
                <tr><th>Device</th><td>${escapeHtml(detail.device || detail.gpu || "—")}</td></tr>
                <tr><th>Search Algorithm</th><td>${escapeHtml(detail.searchAlgorithm || "—")}</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title" style="font-size:20px;">Лучшие модели</h3>
              <p class="card-subtitle">Результаты текущего запуска</p>
            </div>
          </div>

          ${
            detail.models?.length
              ? `
                <div class="table-wrap">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>mAP</th>
                        <th>FPS</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${detail.models
                        .slice(0, 4)
                        .map(
                          (model) => `
                            <tr>
                              <td><strong>${escapeHtml(model.name)}</strong></td>
                              <td>${metricValue(getModelMetric(model, "map"), 2)}</td>
                              <td>${metricValue(model.fps, 0)}</td>
                              <td>${metricValue(model.sizeMb, 0)} MB</td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : `<div class="empty-state">Модели ещё не доступны.</div>`
          }
        </article>
      </section>
    </div>
  `;
}

function renderRunModels(detail) {
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">Модели и параметры</h3>
          <p class="card-subtitle">Итоговые параметры после обучения</p>
        </div>
      </div>

      ${
        detail.models?.length
          ? `
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>mAP</th>
                    <th>P</th>
                    <th>R</th>
                    <th>FPS</th>
                    <th>Size</th>
                    <th>Параметры</th>
                  </tr>
                </thead>
                <tbody>
                  ${detail.models
                    .map((model) => {
                      const params = model.trainedParams || {};
                      return `
                        <tr>
                          <td><strong>${escapeHtml(model.name)}</strong></td>
                          <td>${metricValue(getModelMetric(model, "map"), 2)}</td>
                          <td>${metricValue(model.precision, 2)}</td>
                          <td>${metricValue(model.recall, 2)}</td>
                          <td>${metricValue(model.fps, 0)}</td>
                          <td>${metricValue(model.sizeMb, 0)} MB</td>
                          <td>
                            <div class="param-chips">
                              ${
                                Object.keys(params).length
                                  ? Object.entries(params)
                                      .map(
                                        ([key, value]) =>
                                          `<span class="param-chip">${escapeHtml(key)}: ${escapeHtml(String(value))}</span>`
                                      )
                                      .join("")
                                  : `<span class="param-chip">Нет параметров</span>`
                              }
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `<div class="empty-state">Нет данных по моделям.</div>`
      }
    </section>
  `;
}

function renderRunEdge(detail) {
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">Графики обучения</h3>
          <p class="card-subtitle">История обучения моделей данного запуска</p>
        </div>
      </div>

      ${
        detail.edgeCharts?.length
          ? `
            <div class="stack">
              ${detail.edgeCharts
                .map(
                  (edge) => `
                    <article class="run-summary-card">
                      <div class="card-header">
                        <div>
                          <h4 class="card-title" style="font-size:18px;">${escapeHtml(edge.model)}</h4>
                        </div>
                      </div>

                      <div class="chart-grid">
                        <div class="chart-card">
                          <div class="chart-title">Loss</div>
                          ${sparkline(edge.history?.loss || [])}
                        </div>
                        <div class="chart-card">
                          <div class="chart-title">mAP</div>
                          ${sparkline(edge.history?.map || [])}
                        </div>
                        <div class="chart-card">
                          <div class="chart-title">Precision</div>
                          ${sparkline(edge.history?.precision || [])}
                        </div>
                        <div class="chart-card">
                          <div class="chart-title">Recall</div>
                          ${sparkline(edge.history?.recall || [])}
                        </div>
                      </div>
                    </article>
                  `
                )
                .join("")}
            </div>
          `
          : `<div class="empty-state">Графики обучения пока недоступны.</div>`
      }
    </section>
  `;
}

function applyCompletedRunArtifacts() {
  const block = qs("#runArtifactsBlock");
  const chart = qs("#resultChart");
  const link = qs("#downloadModel");

  if (block) {
    block.hidden = false;
  }

  if (chart) {
    chart.src = `${TEST_CHART_URL}?t=${Date.now()}`;
  }

  if (link) {
    link.href = TEST_MODEL_URL;
    link.setAttribute("download", "dummy.pt");
    link.textContent = "Скачать dummy.pt";
  }
}

function startRunLogsPolling(runId, textareaId, statusId, live, onUpdate) {
  const textarea = qs(`#${textareaId}`);
  const statusEl = qs(`#${statusId}`);
  if (!textarea) return () => {};

  let timerId = null;
  let lastText = null;
  let artifactsApplied = false;

  const pushUpdate = (payload) => {
    if (typeof onUpdate === "function") {
      onUpdate(payload);
    }
  };

  const load = async () => {
    try {
      const loadingText = "Загрузка логов...";
      if (statusEl) statusEl.textContent = loadingText;
      pushUpdate({ statusText: loadingText });

      const text = await api(`/runs/${runId}/logs`, { asText: true });

      if (text !== lastText) {
        textarea.value = text;
        textarea.scrollTop = textarea.scrollHeight;
        lastText = text;
        pushUpdate({ text });
      }

      const runDetail = await api(`/runs/${runId}`);
      const currentStatus = String(runDetail?.status || "").toLowerCase();
      const isCompletedStatus = ["completed", "finished"].includes(currentStatus);

      if (isCompletedStatus) {
        applyCompletedRunArtifacts();
        artifactsApplied = true;

        const completedText = "Обучение завершено";
        if (statusEl) statusEl.textContent = completedText;
        pushUpdate({ statusText: completedText, completed: true });

        state.runDetails[String(runId)] = runDetail;
        refreshCoreData().catch(() => {});

        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }

        return;
      }

      const updatedText = `Обновлено: ${new Date().toLocaleTimeString()}`;
      if (statusEl) statusEl.textContent = updatedText;
      pushUpdate({ statusText: updatedText });

      if (artifactsApplied) {
        const block = qs("#runArtifactsBlock");
        if (block) {
          block.hidden = true;
        }
        artifactsApplied = false;
      }
    } catch (error) {
      const errorText = `Ошибка: ${error.message}`;
      if (statusEl) statusEl.textContent = errorText;
      pushUpdate({ statusText: errorText });
    }
  };

  load();

  if (live) {
    timerId = setInterval(load, LOGS_POLL_INTERVAL_MS);
  }

  return () => {
    if (timerId) clearInterval(timerId);
  };
}

function renderRunLogs() {
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">Логи запуска</h3>
          <p class="card-subtitle">Поток логов для выбранного запуска</p>
        </div>
      </div>

      <textarea id="runLogsTextarea" class="logs-box" readonly spellcheck="false"></textarea>
      <div id="runLogsStatus" class="logs-status"></div>

      <div id="runArtifactsBlock" hidden style="margin-top:16px;">
        <div class="chart-grid">
          <article class="chart-card">
            <div class="chart-title">Тестовый график</div>
            <img
              id="resultChart"
              src=""
              alt="Test chart"
              style="display:block; width:100%; max-width:100%; border-radius:16px; border:1px solid var(--line); background:#fff;"
            />
          </article>

          <article class="chart-card">
            <div class="chart-title">Тестовая модель</div>
            <a
              id="downloadModel"
              href="#"
              download="dummy.pt"
              class="btn btn-primary artifact-download-btn"
            >
              Скачать dummy.pt
            </a>
          </article>
        </div>
      </div>
    </section>
  `;
}

async function renderRunDetailPage(runId) {
  const detail = await ensureRunDetail(runId);
  if (!detail) {
    renderRoot(`<div class="empty-state">Запуск не найден.</div>`);
    return;
  }

  state.activeRunId = detail.id || runId;
  state.activeDatasetId = detail.datasetId || state.activeDatasetId;

  setPageMeta(`Run #${detail.id || runId}`, "Метрики, модели, графики и логи");

  const tab = state.runTab || "overview";

  renderRoot(`
    <div class="page-stack">
      <a href="#runs" class="chip" style="width:max-content;">← Назад к Runs</a>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Run #${escapeHtml(detail.id || runId)}</h2>
            <p class="card-subtitle">${escapeHtml(detail.datasetName || "—")}</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-secondary" id="openCompareFromRun" type="button">Compare</button>
            <button class="btn btn-secondary" id="openExportsFromRun" type="button">Exports</button>
          </div>
        </div>

        <div class="tabs">
          <button type="button" class="tab-btn ${tab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
          <button type="button" class="tab-btn ${tab === "models" ? "active" : ""}" data-tab="models">Models</button>
          <button type="button" class="tab-btn ${tab === "edge" ? "active" : ""}" data-tab="edge">Edge</button>
          <button type="button" class="tab-btn ${tab === "logs" ? "active" : ""}" data-tab="logs">Logs</button>
        </div>

        <div id="runDetailContent">
          ${
            tab === "models"
              ? renderRunModels(detail)
              : tab === "edge"
              ? renderRunEdge(detail)
              : tab === "logs"
              ? renderRunLogs()
              : renderRunOverview(detail)
          }
        </div>
      </section>
    </div>
  `);

  qsa(".tab-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      state.runTab = button.dataset.tab;
      await renderRunDetailPage(runId);
    });
  });

  qs("#openCompareFromRun")?.addEventListener("click", () => {
    state.compareDatasetId = detail.datasetId;
    state.compareRunIds = getRunsByDataset(detail.datasetId)
      .slice(0, 3)
      .map((run) => run.id);
    window.location.hash = "#compare";
  });

  qs("#openExportsFromRun")?.addEventListener("click", () => {
    window.location.hash = "#exports";
  });

  if (tab === "logs") {
    const live = String(detail.status || "").toLowerCase() === "running";
    stopLogsPolling = startRunLogsPolling(
      detail.id || runId,
      "runLogsTextarea",
      "runLogsStatus",
      live
    );
  }
}

async function renderComparePage() {
  setPageMeta("Compare", "Сравнение запусков по одному датасету");

  const datasetId = state.compareDatasetId || state.activeDatasetId || state.datasets[0]?.id || null;
  state.compareDatasetId = datasetId;

  const datasetRuns = datasetId ? getRunsByDataset(datasetId) : [];
  if (!state.compareRunIds.length && datasetRuns.length) {
    state.compareRunIds = datasetRuns.slice(0, 2).map((run) => run.id);
  }

  const selectedRunIds = state.compareRunIds.filter((id) =>
    datasetRuns.some((run) => String(run.id) === String(id))
  );

  const details = await Promise.all(selectedRunIds.map((id) => ensureRunDetail(id)));
  const compareItems = details
    .filter(Boolean)
    .map((detail) => {
      const bestModel =
        detail.models?.find((model) => model.name === detail.summary?.bestModel) ||
        detail.models?.[0] ||
        null;

      return {
        detail,
        bestModel,
      };
    });

  const mapValues = compareItems.map((item) => getModelMetric(item.bestModel, "map"));
  const precisionValues = compareItems.map((item) => item.bestModel?.precision);
  const recallValues = compareItems.map((item) => item.bestModel?.recall);
  const fpsValues = compareItems.map((item) => item.bestModel?.fps);
  const sizeValues = compareItems.map((item) => item.bestModel?.sizeMb);

  renderRoot(`
    <div class="compare-layout">
      <aside class="compare-sidebar">
        <div class="form-group" style="margin-bottom:14px;">
          <label for="compareDatasetSelect">Датасет</label>
          <select id="compareDatasetSelect">
            ${state.datasets
              .map(
                (dataset) =>
                  `<option value="${escapeHtml(dataset.id)}" ${
                    String(dataset.id) === String(datasetId) ? "selected" : ""
                  }>${escapeHtml(dataset.name)}</option>`
              )
              .join("")}
          </select>
        </div>

        <div class="helper-text" style="margin-bottom:12px;">Выберите несколько запусков.</div>

        <div class="compare-run-list" id="compareRunList">
          ${
            datasetRuns.length
              ? datasetRuns
                  .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
                  .map(
                    (run) => `
                      <div class="compare-run-item">
                        <label>
                          <input
                            type="checkbox"
                            value="${escapeHtml(run.id)}"
                            ${selectedRunIds.includes(run.id) ? "checked" : ""}
                          />
                          <span>
                            <strong>Run #${escapeHtml(run.id)}</strong>
                            <div class="compare-run-meta">
                              ${escapeHtml(formatDateTime(run.startedAt))}<br />
                              ${escapeHtml(run.bestModel || "—")} · ${metricValue(run.bestMap, 2)} · ${escapeHtml(
                              run.device || run.gpu || "—"
                            )}
                            </div>
                          </span>
                        </label>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-state">Для этого датасета пока нет запусков</div>`
          }
        </div>
      </aside>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Сравнение запусков</h2>
            <p class="card-subtitle">Качество, скорость и итоговые параметры</p>
          </div>
        </div>

        ${
          compareItems.length >= 2
            ? `
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Параметр</th>
                      ${compareItems
                        .map((item) => `<th>Run #${escapeHtml(item.detail.id)}</th>`)
                        .join("")}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Status</strong></td>
                      ${compareItems.map((item) => `<td>${renderStatus(item.detail.status)}</td>`).join("")}
                    </tr>
                    <tr>
                      <td><strong>Best model</strong></td>
                      ${compareItems
                        .map((item) => `<td>${escapeHtml(item.bestModel?.name || "—")}</td>`)
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>mAP</strong></td>
                      ${compareItems
                        .map(
                          (item) => `<td class="${bestCellClass(
                            mapValues,
                            getModelMetric(item.bestModel, "map")
                          )}">${metricValue(getModelMetric(item.bestModel, "map"), 2)}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Precision</strong></td>
                      ${compareItems
                        .map(
                          (item) => `<td class="${bestCellClass(
                            precisionValues,
                            item.bestModel?.precision
                          )}">${metricValue(item.bestModel?.precision, 2)}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Recall</strong></td>
                      ${compareItems
                        .map(
                          (item) => `<td class="${bestCellClass(
                            recallValues,
                            item.bestModel?.recall
                          )}">${metricValue(item.bestModel?.recall, 2)}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>FPS</strong></td>
                      ${compareItems
                        .map(
                          (item) => `<td class="${bestCellClass(
                            fpsValues,
                            item.bestModel?.fps
                          )}">${metricValue(item.bestModel?.fps, 0)}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Size MB</strong></td>
                      ${compareItems
                        .map(
                          (item) => `<td class="${bestCellClass(
                            sizeValues,
                            item.bestModel?.sizeMb,
                            true
                          )}">${metricValue(item.bestModel?.sizeMb, 0)}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Device</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(
                              item.bestModel?.trainedParams?.device || item.detail.device || "—"
                            )}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Epochs</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(
                              String(item.bestModel?.trainedParams?.epochs ?? "—")
                            )}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Batch size</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(
                              String(item.bestModel?.trainedParams?.batchSize ?? "—")
                            )}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Image size</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(
                              String(item.bestModel?.trainedParams?.imageSize ?? "—")
                            )}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Optimizer</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(item.bestModel?.trainedParams?.optimizer || "—")}</td>`
                        )
                        .join("")}
                    </tr>
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Выберите минимум два запуска для сравнения</div>`
        }
      </section>
    </div>
  `);

  qs("#compareDatasetSelect")?.addEventListener("change", async (event) => {
    state.compareDatasetId = event.target.value;
    state.compareRunIds = getRunsByDataset(state.compareDatasetId)
      .slice(0, 2)
      .map((run) => run.id);
    await renderComparePage();
  });

  qs("#compareRunList")?.addEventListener("change", async () => {
    state.compareRunIds = qsa('input[type="checkbox"]:checked', qs("#compareRunList")).map(
      (input) => input.value
    );
    await renderComparePage();
  });
}

function renderExportsPage() {
  setPageMeta("Exports", "Выгрузка конфигураций запусков");

  const datasetId = state.activeDatasetId || state.datasets[0]?.id || "";
  const filteredRuns = datasetId ? getRunsByDataset(datasetId) : state.runs;

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Экспорт конфигураций</h2>
            <p class="card-subtitle">Скачивание данных по отдельным запускам</p>
          </div>
        </div>

        <div class="form-group" style="max-width:360px; margin-bottom:16px;">
          <label for="exportsDatasetSelect">Датасет</label>
          <select id="exportsDatasetSelect">
            ${state.datasets
              .map(
                (dataset) =>
                  `<option value="${escapeHtml(dataset.id)}" ${
                    String(dataset.id) === String(datasetId) ? "selected" : ""
                  }>${escapeHtml(dataset.name)}</option>`
              )
              .join("")}
          </select>
        </div>

        ${
          filteredRuns.length
            ? `
              <div class="grid-auto">
                ${filteredRuns
                  .map(
                    (run) => `
                      <article class="export-card">
                        <div class="dataset-card-header">
                          <div>
                            <div class="dataset-name">Run #${escapeHtml(run.id)}</div>
                            <div class="dataset-meta">${escapeHtml(run.datasetName || "—")}</div>
                          </div>
                          ${renderStatus(run.status)}
                        </div>

                        <div class="meta-chips">
                          <span class="chip">Best model: ${escapeHtml(run.bestModel || "—")}</span>
                          <span class="chip">mAP: ${metricValue(run.bestMap, 2)}</span>
                          <span class="chip">Device: ${escapeHtml(run.device || run.gpu || "—")}</span>
                        </div>

                        <div class="form-actions" style="margin-top:14px;">
                          <a class="btn btn-primary" href="${API_BASE}/exports/runs/${encodeURIComponent(
                            run.id
                          )}?format=json" download>JSON</a>
                          <a class="btn btn-secondary" href="${API_BASE}/exports/runs/${encodeURIComponent(
                            run.id
                          )}?format=yaml" download>YAML</a>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-state">Нет запусков для экспорта</div>`
        }
      </section>
    </div>
  `);

  qs("#exportsDatasetSelect")?.addEventListener("change", (event) => {
    state.activeDatasetId = event.target.value;
    renderExportsPage();
  });
}

async function renderSettingsPage() {
  setPageMeta("Settings", "Настройки выбранного датасета");

  const datasetId = state.activeDatasetId || state.datasets[0]?.id || null;
  if (!datasetId) {
    renderRoot(`<div class="empty-state">Нет датасетов для настройки</div>`);
    return;
  }

  const detail = await ensureDatasetDetail(datasetId);

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Настройки датасета</h2>
            <p class="card-subtitle">Изменение параметров выбранного датасета</p>
          </div>
        </div>

        <form id="settingsForm">
          <div class="form-grid">
            <div class="form-group">
              <label for="settingsDataset">Датасет</label>
              <select id="settingsDataset" name="datasetId">
                ${state.datasets
                  .map(
                    (dataset) =>
                      `<option value="${escapeHtml(dataset.id)}" ${
                        String(dataset.id) === String(datasetId) ? "selected" : ""
                      }>${escapeHtml(dataset.name)}</option>`
                  )
                  .join("")}
              </select>
            </div>

            <div class="form-group">
              <label for="settingsName">Название</label>
              <input id="settingsName" name="name" type="text" value="${escapeHtml(detail.name || "")}" />
            </div>
          </div>

          <div class="form-group">
            <label for="settingsDescription">Описание</label>
            <textarea id="settingsDescription" name="description">${escapeHtml(
              detail.description || ""
            )}</textarea>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label for="settingsClassesCount">Classes Count</label>
              <input
                id="settingsClassesCount"
                name="classesCount"
                type="number"
                min="1"
                value="${escapeHtml(String(detail.classesCount || ""))}"
              />
            </div>

            <div class="form-group">
              <label for="settingsClassNames">Class Names</label>
              <input
                id="settingsClassNames"
                name="classNames"
                type="text"
                value="${escapeHtml(Array.isArray(detail.classes) ? detail.classes.join(", ") : "")}"
                placeholder="person, car, ball"
              />
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label for="settingsTrainFolder">Train Folder</label>
              <input
                id="settingsTrainFolder"
                name="trainFolder"
                type="text"
                value="${escapeHtml(detail.trainFolder || "")}"
                placeholder="train/images"
              />
            </div>

            <div class="form-group">
              <label for="settingsValFolder">Validation Folder</label>
              <input
                id="settingsValFolder"
                name="valFolder"
                type="text"
                value="${escapeHtml(detail.valFolder || "")}"
                placeholder="valid/images"
              />
            </div>

            <div class="form-group">
              <label for="settingsTestFolder">Test Folder</label>
              <input
                id="settingsTestFolder"
                name="testFolder"
                type="text"
                value="${escapeHtml(detail.testFolder || "")}"
                placeholder="test/images"
              />
            </div>
          </div>

          <div class="helper-text">
            Saving these fields regenerates <code>data.yaml</code> for the selected dataset.
          </div>

          ${
            detail.yamlPath
              ? `
                <div class="form-group">
                  <label for="settingsYamlPath">Current data.yaml</label>
                  <input id="settingsYamlPath" type="text" value="${escapeHtml(detail.yamlPath)}" readonly />
                </div>
                <textarea
                  class="logs-box"
                  readonly
                  spellcheck="false"
                  style="height:220px; min-height:220px;"
                >${escapeHtml(detail.yamlContent || "")}</textarea>
              `
              : `
                <div class="notice warning">
                  data.yaml is not configured yet. Fill in classes and folders, then save.
                </div>
              `
          }

          <div class="form-grid">
            <div class="form-group">
              <label for="settingsMetric">Метрика</label>
              <select id="settingsMetric" name="targetMetric" ${
                detail.availableMetrics?.length ? "" : "disabled"
              }>
                ${
                  detail.availableMetrics?.length
                    ? optionMarkup(
                        detail.availableMetrics.map((value) => ({ value, label: value })),
                        detail.settings?.targetMetric
                      )
                    : `<option value="">Нет доступных метрик</option>`
                }
              </select>
            </div>

          </div>

          <div class="form-grid">
            <div class="form-group">
              <label for="settingsDevice">Device</label>
              <select id="settingsDevice" name="device">
                ${optionMarkup(
                  (detail.availableDevices?.length
                    ? detail.availableDevices
                    : ["auto", "gpu0", "gpu1", "cpu"]
                  ).map((value) => ({ value, label: value.toUpperCase() })),
                  detail.settings?.device || "auto"
                )}
              </select>
            </div>

            <div class="form-group">
              <label for="settingsPriority">Priority</label>
              <select id="settingsPriority" name="priority">
                ${optionMarkup(
                  [
                    { value: "normal", label: "Normal" },
                    { value: "high", label: "High" },
                    { value: "low", label: "Low" },
                  ],
                  detail.settings?.priority || "normal"
                )}
              </select>
            </div>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Сохранить</button>
          </div>
        </form>
      </section>
    </div>
  `);

  qs("#settingsDataset")?.addEventListener("change", async (event) => {
    state.activeDatasetId = event.target.value;
    await renderSettingsPage();
  });

  qs("#settingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNotice();

    const form = event.currentTarget;
    const button = qs('button[type="submit"]', form);
    if (button) button.disabled = true;

    try {
      const payload = serializeForm(form);
      await api(`/datasets/${payload.datasetId}/settings`, {
        method: "PUT",
        body: payload,
      });

      delete state.datasetDetails[String(payload.datasetId)];
      await refreshCoreData();
      state.activeDatasetId = payload.datasetId;
      showNotice("Настройки сохранены. YAML обновлен.", "success");
      await renderSettingsPage();
    } catch (error) {
      showNotice(error.message || "Не удалось сохранить настройки.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

async function route() {
  cleanupSideEffects();
  clearNotice();

  const routeInfo = parseRoute();
  setActiveNav(routeInfo.name);

  try {
    switch (routeInfo.name) {
      case "dashboard":
        renderDashboardPage();
        return;
      case "datasets":
        await renderDatasetsPage();
        return;
      case "runs":
        renderRunsPage();
        return;
      case "run-detail":
        await renderRunDetailPage(routeInfo.id);
        return;
      case "compare":
        await renderComparePage();
        return;
      case "exports":
        renderExportsPage();
        return;
      case "settings":
        await renderSettingsPage();
        return;
      default:
        window.location.hash = "#dashboard";
    }
  } catch (error) {
    renderRoot(`
      <div class="notice error">
        ${escapeHtml(error.message || "Ошибка загрузки данных.")}
      </div>
    `);
  }
}

async function bootstrap() {
  try {
    setLoading("Загрузка данных...");
    await refreshCoreData();

    qs("#refreshButton")?.addEventListener("click", async () => {
      try {
        setLoading("Обновление...");
        state.datasetDetails = {};
        state.runDetails = {};
        await refreshCoreData();
        await route();
      } catch (error) {
        showNotice(error.message || "Не удалось обновить данные.", "error");
      }
    });

    if (!window.location.hash) {
      window.location.hash = "#dashboard";
    }

    await route();
    window.addEventListener("hashchange", () => {
      route();
    });
  } catch (error) {
    renderRoot(`
      <div class="notice error">
        ${escapeHtml(error.message || "Не удалось инициализировать интерфейс.")}
      </div>
    `);
  }
}

if (typeof window !== "undefined" && !window.__AUTOML_APP_BOOTSTRAP_BOUND__) {
  window.__AUTOML_APP_BOOTSTRAP_BOUND__ = true;
  window.addEventListener("DOMContentLoaded", bootstrap);

  window.formToJSON = formToJSON;
  window.mockStartTraining = mockStartTraining;
  window.fetchLogs = fetchLogs;
  window.renderLogsWithAutoscroll = renderLogsWithAutoscroll;
  window.startLogsPolling = startLogsPolling;
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    bootstrap,
    formToJSON,
    mockStartTraining,
    fetchLogs,
    renderLogsWithAutoscroll,
    startLogsPolling,
    serializeForm,
    fetchDummyStatus,
    startDummyStatusPolling,
    normalizeDummyStatus,
    applyDummyStatus,
    };
}
