const BASE_URL = "";
const LOGS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_INTERVAL_MS = 3000;

function buildApiUrl(path) {
  return `${BASE_URL}/api${path}`;
}

function buildStaticUrl(path) {
  return `${BASE_URL}${path}`;
}

const state = {
  dashboard: null,
  datasets: [],
  datasetSources: [],
  runs: [],
  datasetDetails: {},
  runDetails: {},
  activeDatasetId: null,
  activeRunId: null,
  compareDatasetId: null,
  compareRunIds: [],
  runTab: "overview",
  automlStatus: {
    modelNumber: "вЂ”",
    totalCount: "вЂ”",
    status: "unknown",
    error: null,
  },
  trainingMonitor: {
    visible: false,
    runId: null,
    statusText: "РћР¶РёРґР°РЅРёРµ Р·Р°РїСѓСЃРєР°...",
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
  if (!value) return "вЂ”";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "вЂ”";
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
  if (Number.isNaN(num)) return "вЂ”";
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
  if (["failed", "error"].includes(value)) return "failed";
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

function setLoading(message = "Р—Р°РіСЂСѓР·РєР°...") {
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
  const url = buildApiUrl(path);
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

async function refreshDatasetSources() {
  try {
    state.datasetSources = ensureArray(await api("/dataset-sources"));
  } catch (error) {
    state.datasetSources = [];
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
      if (statusEl) statusEl.textContent = "Р—Р°РіСЂСѓР·РєР° Р»РѕРіРѕРІ...";
      const text = await fetchLogs(url);

      if (text !== lastText) {
        renderLogsWithAutoscroll(textarea, text);
        lastText = text;
      }

      if (statusEl) {
        statusEl.textContent = `РћР±РЅРѕРІР»РµРЅРѕ: ${new Date().toLocaleTimeString()}`;
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = `РћС€РёР±РєР°: ${error.message}`;
      }
    }
  };

  tick();
  timerId = setInterval(tick, intervalMs);

  return () => {
    if (timerId) clearInterval(timerId);
  };
}

function normalizeAutomlStatus(payload = {}) {
  return {
    modelNumber:
      payload.modelNumber ??
      payload.current_model ??
      payload.model_number ??
      payload.model ??
      "вЂ”",
    totalCount:
      payload.totalCount ??
      payload.total_models ??
      payload.total_count ??
      payload.total ??
      "вЂ”",
    status: payload.status ?? "unknown",
    error: payload.error ?? null,
    runId: payload.runId ?? payload.run_id ?? null,
  };
}

async function fetchAutomlStatus() {
  const data = await api(`/status?t=${Date.now()}`);
  return normalizeAutomlStatus(data);
}


function renderTrainingMonitorBlock() {
  const monitor = state.trainingMonitor || {};
  const hiddenAttr = monitor.visible ? "" : "hidden";

  return `
    <article class="run-summary-card" id="datasetTrainingMonitor" ${hiddenAttr} style="margin-top:16px;">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">РњРѕРЅРёС‚РѕСЂРёРЅРі РѕР±СѓС‡РµРЅРёСЏ</h3>
          <p class="card-subtitle">РЎС‚Р°С‚СѓСЃ Р·Р°РїСѓСЃРєР° Рё РІС‹РІРѕРґ Р»РѕРіРѕРІ</p>
        </div>
      </div>

      <div id="datasetTrainingLogsStatus" class="logs-status">${escapeHtml(
        monitor.statusText || "РћР¶РёРґР°РЅРёРµ Р·Р°РїСѓСЃРєР°..."
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
      
      if (lastLines.includes('РћР‘РЈР§Р•РќРР• РЈРЎРџР•РЁРќРћ Р—РђР’Р•Р РЁР•РќРћ') || 
          lastLines.includes(' РћР‘РЈР§Р•РќРР• РЈРЎРџР•РЁРќРћ Р—РђР’Р•Р РЁР•РќРћ!')) {
        setTrainingMonitorStatus(' РћР±СѓС‡РµРЅРёРµ Р·Р°РІРµСЂС€РµРЅРѕ');

        if (state.trainingMonitor.pollingInterval) {
          clearInterval(state.trainingMonitor.pollingInterval);
          state.trainingMonitor.pollingInterval = null;
        }

        refreshCoreData();
        
      } else if (lastLines.includes('РћС€РёР±РєР°')) {
        setTrainingMonitorStatus('РћС€РёР±РєР° РѕР±СѓС‡РµРЅРёСЏ');

        if (state.trainingMonitor.pollingInterval) {
          clearInterval(state.trainingMonitor.pollingInterval);
          state.trainingMonitor.pollingInterval = null;
        }
        
      } else {
        const lastLine = logs.split('\n').pop();
        if (lastLine && !lastLine.includes('[')) {
          setTrainingMonitorStatus(lastLine);
        } else {
          setTrainingMonitorStatus('РћР±СѓС‡РµРЅРёРµ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ...');
        }
      }
      
    } catch (error) {
      console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р»РѕРіРѕРІ:', error);
      setTrainingMonitorStatus('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р»РѕРіРѕРІ');
    }
  };
  
  updateLogs();

  state.trainingMonitor.pollingInterval = setInterval(updateLogs, 2000);
}



function trainingMonitorLine(message) {
  return `[${new Date().toLocaleTimeString("ru-RU")}] ${message}`;
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
  setPageMeta("Dashboard", "РћР±Р·РѕСЂ РґР°С‚Р°СЃРµС‚РѕРІ, Р·Р°РїСѓСЃРєРѕРІ Рё СЂРµР·СѓР»СЊС‚Р°С‚РѕРІ");

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
        ${renderKpi("Datasets", String(summary.datasetsCount), "Р’СЃРµРіРѕ РґР°С‚Р°СЃРµС‚РѕРІ")}
        ${renderKpi("Runs", String(summary.runsCount), "Р’СЃРµРіРѕ Р·Р°РїСѓСЃРєРѕРІ")}
        ${renderKpi("Running", String(summary.runningCount), "РђРєС‚РёРІРЅС‹Рµ Р·Р°РґР°С‡Рё")}
        ${renderKpi("Queued", String(summary.queuedCount), "Р’ РѕС‡РµСЂРµРґРё")}
      </section>

      ${renderAutomlStatusCard()}

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Datasets</h2>
            <p class="card-subtitle">Р’С‹Р±РµСЂРёС‚Рµ РґР°С‚Р°СЃРµС‚ РґР»СЏ Р·Р°РїСѓСЃРєР° Рё Р°РЅР°Р»РёР·Р° СЂРµР·СѓР»СЊС‚Р°С‚РѕРІ</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-primary" id="goDatasetsButton" type="button">РћС‚РєСЂС‹С‚СЊ Datasets</button>
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
                            <div class="dataset-name">${escapeHtml(dataset.name || "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ")}</div>
                            <div class="dataset-meta">

                            </div>
                          </div>
                          ${renderStatus(dataset.status || "ready")}
                        </div>

                        <div class="meta-chips">
                          <span class="chip">Best model: ${escapeHtml(dataset.bestModel || "вЂ”")}</span>
                          <span class="chip">Best mAP: ${metricValue(dataset.bestMap, 2)}</span>
                        </div>

                        <div class="form-actions" style="margin-top:14px;">
                          <button class="btn btn-secondary dashboard-dataset-open" data-dataset-id="${escapeHtml(
                            dataset.id
                          )}" type="button">РћС‚РєСЂС‹С‚СЊ</button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-state">Р”Р°С‚Р°СЃРµС‚С‹ РїРѕРєР° РЅРµ РґРѕР±Р°РІР»РµРЅС‹</div>`
        }
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Latest runs</h2>
            <p class="card-subtitle">РСЃС‚РѕСЂРёСЏ РїРѕСЃР»РµРґРЅРёС… Р·Р°РїСѓСЃРєРѕРІ</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-secondary" id="goRunsButton" type="button">РћС‚РєСЂС‹С‚СЊ Runs</button>
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
                            <td>${escapeHtml(run.datasetName || "вЂ”")}</td>
                            <td>${renderStatus(run.status)}</td>
                            <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                            <td>${escapeHtml(run.bestModel || "вЂ”")}</td>
                            <td>${metricValue(run.bestMap, 2)}</td>
                            <td>${escapeHtml(run.device || run.gpu || "вЂ”")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Р—Р°РїСѓСЃРєРѕРІ РїРѕРєР° РЅРµС‚</div>`
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

  stopStatusPolling = startAutomlStatusPolling();
}


function addHyperparamRow() {
  const container = document.getElementById('hyperparamsContainer');
  const newRow = document.createElement('div');
  newRow.className = 'hyperparam-row';
  
  newRow.innerHTML = `
    <input type="text" name="hyperparam_name[]" placeholder="РќР°Р·РІР°РЅРёРµ" class="hyperparam-name" />
        <select name="hyperparam_type[]" class="hyperparam-type">
      <option value="list">List</option>
      <option value="range">Range (min max)</option>
    </select>
    <input type="text" name="hyperparam_values[]" placeholder="Р—РЅР°С‡РµРЅРёСЏ" class="hyperparam-values" />
    <button type="button" class="btn-remove-param" onclick="removeHyperparamRow(this)">вњ–</button>
  `;
  container.appendChild(newRow);
}

function removeHyperparamRow(button) {
  const row = button.closest('.hyperparam-row');
  if (row && document.querySelectorAll('.hyperparam-row').length > 1) {
    row.remove();
  } else {
    showNotice('Р”РѕР»Р¶РЅР° РѕСЃС‚Р°С‚СЊСЃСЏ С…РѕС‚СЏ Р±С‹ РѕРґРЅР° СЃС‚СЂРѕРєР°', 'warning');
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
  const hyperparamRows = document.querySelectorAll('.hyperparam-row');

  hyperparamRows.forEach(row => {
    const typeSelect = row.querySelector('select[name="hyperparam_type[]"]');
    const valuesInput = row.querySelector('input[name="hyperparam_values[]"]');

    if (valuesInput && typeSelect) {
      const updatePlaceholder = () => {
        valuesInput.placeholder = typeSelect.value === 'list'
          ? 'Values: 0.001 0.01 0.1'
          : 'Range: 0.001 0.1';
      };

      updatePlaceholder();
      typeSelect.onchange = updatePlaceholder;
    }
  });
}

async function renderDatasetsPage() {
  setPageMeta("Datasets", "Р—Р°РіСЂСѓР·РєР° РґР°С‚Р°СЃРµС‚РѕРІ Рё Р·Р°РїСѓСЃРє AutoML");

  const activeId = state.activeDatasetId || state.datasets[0]?.id || null;
  state.activeDatasetId = activeId;

  const datasetDetail = activeId ? await ensureDatasetDetail(activeId) : null;
  const datasetRuns = activeId ? getRunsByDataset(activeId).slice(0, 5) : [];
  const yamlReady = Boolean(datasetDetail?.yamlPath);

  await refreshDatasetSources();
  const datasetSourceOptions = state.datasetSources
    .map((source) => {
      const labelParts = [source.name || source.relativePath || source.id];
      if (source.sourceType) labelParts.push(source.sourceType);
      if (source.trainFolder && source.valFolder) labelParts.push("train/val РЅР°Р№РґРµРЅ");
      return `<option value="${escapeHtml(source.id)}">${escapeHtml(labelParts.filter(Boolean).join(" В· "))}</option>`;
    })
    .join("");

  renderRoot(`
    <div class="page-stack">
      <section class="grid-2">
        <article class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">РќРѕРІС‹Р№ РґР°С‚Р°СЃРµС‚</h2>
              <p class="card-subtitle">Р—Р°РіСЂСѓР·РёС‚Рµ Р°СЂС…РёРІ РёР»Рё РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ РґР°С‚Р°СЃРµС‚Р°</p>
            </div>
          </div>

          <form id="datasetUploadForm">
            <div class="form-grid">
              <div class="form-group">
                <label for="displayName">РќР°Р·РІР°РЅРёРµ</label>
                <input id="displayName" name="displayName" type="text" required />
              </div>
            </div>

            <div class="form-group">
              <label for="description">РћРїРёСЃР°РЅРёРµ</label>
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
              <label for="datasetSource">Р”Р°С‚Р°СЃРµС‚ РёР· РїР°РїРєРё <code>datasets/</code></label>
              <select id="datasetSource" name="datasetSource">
                <option value="">РќРµ РІС‹Р±РёСЂР°С‚СЊ вЂ” Р·Р°РіСЂСѓР¶Сѓ С„Р°Р№Р»</option>
                ${datasetSourceOptions}
              </select>
              <div class="helper-text">
                РќРµ РЅСѓР¶РЅРѕ РІРІРѕРґРёС‚СЊ РїСѓС‚СЊ РІСЂСѓС‡РЅСѓСЋ. РџРѕР»РѕР¶РёС‚Рµ РґР°С‚Р°СЃРµС‚ РІ РїР°РїРєСѓ <code>datasets/</code>
                РЅР° С…РѕСЃС‚Рµ, Рё РѕРЅ РїРѕСЏРІРёС‚СЃСЏ РІ СЌС‚РѕРј СЃРїРёСЃРєРµ.
              </div>
            </div>

            <div class="form-group">
              <label for="datasetFile">Р¤Р°Р№Р» РґР°С‚Р°СЃРµС‚Р°</label>
              <input id="datasetFile" name="datasetFile" type="file" accept=".zip,.yaml,.yml" />
              <div class="helper-text">
                РСЃРїРѕР»СЊР·СѓР№С‚Рµ С„Р°Р№Р», РµСЃР»Рё РґР°С‚Р°СЃРµС‚Р° РµС‰С‘ РЅРµС‚ РІ СЃРїРёСЃРєРµ РІС‹С€Рµ.
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit">Р—Р°РіСЂСѓР·РёС‚СЊ РґР°С‚Р°СЃРµС‚</button>
            </div>
          </form>
        </article>

        <article class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">РЎРїРёСЃРѕРє РґР°С‚Р°СЃРµС‚РѕРІ</h2>
              <p class="card-subtitle">Р’С‹Р±РµСЂРёС‚Рµ РґР°С‚Р°СЃРµС‚ РґР»СЏ СЂР°Р±РѕС‚С‹</p>
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
                              <div class="dataset-name">${escapeHtml(dataset.name || "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ")}</div>
                              <div class="dataset-meta">

                              </div>
                            </div>
                            ${renderStatus(dataset.status || "ready")}
                          </div>

                          <div class="meta-chips">
                            <span class="chip">Best model: ${escapeHtml(dataset.bestModel || "вЂ”")}</span>
                            <span class="chip">Best mAP: ${metricValue(dataset.bestMap, 2)}</span>
                            <span class="chip">Last run: ${escapeHtml(formatDateTime(dataset.lastRunAt))}</span>
                          </div>

                          <div class="form-actions" style="margin-top:14px;">
                            <button class="btn btn-secondary dataset-switch-btn" type="button" data-dataset-id="${escapeHtml(
                              dataset.id
                            )}">Р’С‹Р±СЂР°С‚СЊ</button>
                          </div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              `
              : `<div class="empty-state">Р”Р°С‚Р°СЃРµС‚С‹ РµС‰С‘ РЅРµ РґРѕР±Р°РІР»РµРЅС‹</div>`
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
                  <p class="card-subtitle">${escapeHtml(datasetDetail.description || "Р‘РµР· РѕРїРёСЃР°РЅРёСЏ")}</p>
                </div>
                ${renderStatus(datasetDetail.status || "ready")}
              </div>

              <div class="grid-4" style="margin-bottom:16px;">
                ${renderKpi("Samples", escapeHtml(String(datasetDetail.samples ?? "вЂ”")), "Р Р°Р·РјРµСЂ РґР°С‚Р°СЃРµС‚Р°")}
                ${renderKpi("Classes", escapeHtml(String(datasetDetail.classesCount ?? datasetDetail.classes?.length ?? "вЂ”")), "РљРѕР»РёС‡РµСЃС‚РІРѕ РєР»Р°СЃСЃРѕРІ")}
                ${renderKpi("Best model", escapeHtml(datasetDetail.bestModel || "вЂ”"), "Р›СѓС‡С€Р°СЏ РјРѕРґРµР»СЊ")}
                ${renderKpi("Best mAP", metricValue(datasetDetail.bestMap, 2), "Р›СѓС‡С€РёР№ СЂРµР·СѓР»СЊС‚Р°С‚")}
              </div>

              <div class="grid-2">
                <article class="run-summary-card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title" style="font-size:20px;">Р—Р°РїСѓСЃРє AutoML</h3>
                      <p class="card-subtitle">РќР°СЃС‚СЂРѕР№РєР° Р·Р°РїСѓСЃРєР° РґР»СЏ РІС‹Р±СЂР°РЅРЅРѕРіРѕ РґР°С‚Р°СЃРµС‚Р°</p>
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
                            href="${buildApiUrl(`/datasets/${encodeURIComponent(datasetDetail.id)}/yaml`)}"
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
                        <label for="targetMetric">Р¦РµР»РµРІР°СЏ РјРµС‚СЂРёРєР°</label>
                        <select id="targetMetric" name="targetMetric" ${datasetDetail.availableMetrics?.length ? "" : "disabled"}>
                          ${
                            datasetDetail.availableMetrics?.length
                              ? optionMarkup(
                                  datasetDetail.availableMetrics.map((value) => ({ value, label: value })),
                                  datasetDetail.settings?.targetMetric
                                )
                              : `<option value="">РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… РјРµС‚СЂРёРє</option>`
                          }
                        </select>
                      </div>

                      <div class="form-group">
                        <label for="device">РЈСЃС‚СЂРѕР№СЃС‚РІРѕ</label>
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
                        <label for="runNotes">РљРѕРјРјРµРЅС‚Р°СЂРёР№</label>
                        <input id="runNotes" name="notes" type="text" placeholder="РќРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" />
                      </div>
                    </div>

                    <div class="form-group">
                      <label for="searchAlg">РђР»РіРѕСЂРёС‚Рј РџРѕРёСЃРєР°</label>
                      <select id="searchAlg" name="searchAlg">
                        ${optionMarkup(
                          (datasetDetail.availableSearchAlgorithms?.length
                            ? datasetDetail.availableSearchAlgorithms
                            : ["OptunaTPE"]
                          ).map((value) => ({ value, label: value.toUpperCase() })),
                          datasetDetail.settings?.searchAlgorithm || "OptunaTPE"
                        )}
                        </select>
                      </div>
                      <div class="form-group" id="optunaTrialsGroup">
                        <label for="optunaTrials">Trial Count (Optuna TPE)</label>
                        <input type="number" id="optunaTrials" name="optunaTrials" min="1" max="1000" value="10" step="1"
                          class="form-control"
                        />
                        <small class="form-text text-muted">Number of Optuna trials (1-1000)</small>
                      </div>

                      <div class="form-group">
                        <label>Р“РёРїРµСЂРїР°СЂР°РјРµС‚СЂС‹</label>
                        <div id="hyperparamsContainer">
                          <div class="hyperparam-row">
                            <input type="text" name="hyperparam_name[]" placeholder="РќР°Р·РІР°РЅРёРµ" class="hyperparam-name" />
                            <!-- select Р±СѓРґРµС‚ Р·Р°РјРµРЅРµРЅ РЅР° hidden РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ Р°Р»РіРѕСЂРёС‚РјР° -->
                            <select name="hyperparam_type[]" class="hyperparam-type">
                              <option value="list">РЎРїРёСЃРѕРє Р·РЅР°С‡РµРЅРёР№</option>
                              <option value="range">Р”РёР°РїР°Р·РѕРЅ (РјРёРЅ РјР°РєСЃ)</option>
                            </select>
                            <input type="text" name="hyperparam_values[]" placeholder="Р—РЅР°С‡РµРЅРёСЏ: 0.001 0.01 0.1" class="hyperparam-values" />
                            <button type="button" class="btn-remove-param" onclick="removeHyperparamRow(this)">вњ–</button>
                          </div>
                        </div>
                        <button type="button" id="addHyperparamBtn" class="btn-add-param">+ Р”РѕР±Р°РІРёС‚СЊ РіРёРїРµСЂРїР°СЂР°РјРµС‚СЂ</button>
                      </div>
                    <div class="form-actions">
                      <button class="btn btn-primary" type="submit" ${yamlReady ? "" : "disabled"}>
                        Р—Р°РїСѓСЃС‚РёС‚СЊ AutoML
                      </button>
                    </div>
                  </form>
                  ${renderTrainingMonitorBlock()}
                </article>

                <article class="run-summary-card">
                  <div class="card-header">
                    <div>
                      <h3 class="card-title" style="font-size:20px;">Р›СѓС‡С€РёРµ РјРѕРґРµР»Рё</h3>
                      <p class="card-subtitle">Р РµР·СѓР»СЊС‚Р°С‚С‹ РїРѕ РІС‹Р±СЂР°РЅРЅРѕРјСѓ РґР°С‚Р°СЃРµС‚Сѓ</p>
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
                      : `<div class="empty-state">РџРѕ РґР°С‚Р°СЃРµС‚Сѓ РїРѕРєР° РЅРµС‚ РѕР±СѓС‡РµРЅРЅС‹С… РјРѕРґРµР»РµР№.</div>`
                  }
                </article>
              </div>

              <article class="run-summary-card" style="margin-top:16px;">
                <div class="card-header">
                  <div>
                    <h3 class="card-title" style="font-size:20px;">РџРѕСЃР»РµРґРЅРёРµ Р·Р°РїСѓСЃРєРё РїРѕ РґР°С‚Р°СЃРµС‚Сѓ</h3>
                    <p class="card-subtitle">РџРµСЂРµС…РѕРґ Рє РґРµС‚Р°Р»СЏРј Р·Р°РїСѓСЃРєР°</p>
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
                                    <td>${escapeHtml(run.bestModel || "вЂ”")}</td>
                                    <td>${metricValue(run.bestMap, 2)}</td>
                                  </tr>
                                `
                              )
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    `
                    : `<div class="empty-state">РџРѕ СЌС‚РѕРјСѓ РґР°С‚Р°СЃРµС‚Сѓ РµС‰С‘ РЅРµС‚ Р·Р°РїСѓСЃРєРѕРІ</div>`
                }
              </article>
            </section>
          `
          : `
            <section class="card">
              <div class="empty-state">Р’С‹Р±РµСЂРёС‚Рµ РґР°С‚Р°СЃРµС‚ РёР»Рё Р·Р°РіСЂСѓР·РёС‚Рµ РЅРѕРІС‹Р№</div>
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
      const datasetSourceValue = String(formData.get("datasetSource") || "").trim();
      const datasetFileValue = formData.get("datasetFile");
      const hasDatasetFile =
        typeof File !== "undefined" &&
        datasetFileValue instanceof File &&
        datasetFileValue.name &&
        datasetFileValue.size >= 0;

      if (!datasetSourceValue && !hasDatasetFile) {
        throw new Error("Р’С‹Р±РµСЂРёС‚Рµ РґР°С‚Р°СЃРµС‚ РёР· СЃРїРёСЃРєР° РёР»Рё Р·Р°РіСЂСѓР·РёС‚Рµ Р°СЂС…РёРІ / YAML С„Р°Р№Р».");
      }

      if (datasetSourceValue) {
        formData.set("datasetSource", datasetSourceValue);
      } else {
        formData.delete("datasetSource");
      }

      if (!hasDatasetFile) {
        formData.delete("datasetFile");
      }

      const created = await api("/datasets", {
        method: "POST",
        body: formData,
      });

      state.datasetDetails = {};
      await refreshCoreData();
      state.activeDatasetId = created?.id || state.datasets[0]?.id || null;
      showNotice(
        created?.yamlReady
          ? "Р”Р°С‚Р°СЃРµС‚ Р·Р°РіСЂСѓР¶РµРЅ, data.yaml РЅР°СЃС‚СЂРѕРµРЅ."
          : "Р”Р°С‚Р°СЃРµС‚ Р·Р°РіСЂСѓР¶РµРЅ. data.yaml РїРѕРєР° РЅРµ РЅР°СЃС‚СЂРѕРµРЅ.",
        created?.yamlReady ? "success" : "warning"
      );
      await renderDatasetsPage();
    } catch (error) {
      showNotice(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°С‚Р°СЃРµС‚.", "error");
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
  setTrainingMonitorStatus("РџРѕРґРіРѕС‚РѕРІРєР° Р·Р°РїСѓСЃРєР°...");
  setTrainingMonitorLogs("");
  appendTrainingMonitorLog(trainingMonitorLine("РџРѕРґРіРѕС‚РѕРІРєР° РїР°СЂР°РјРµС‚СЂРѕРІ Р·Р°РїСѓСЃРєР°"));

  try {
    if (!datasetDetail?.yamlPath) {
      throw new Error("Dataset YAML is not configured. Open Settings and save classes/folders first.");
    }

    const payload = serializeForm(form);

    const hyperparams = collectHyperparams();
    if (Object.keys(hyperparams).length > 0) {
      payload.hyperparams = hyperparams;
      appendTrainingMonitorLog(trainingMonitorLine(`Р”РѕР±Р°РІР»РµРЅРѕ ${Object.keys(hyperparams).length} РіРёРїРµСЂРїР°СЂР°РјРµС‚СЂРѕРІ`));
    }
    const trials = payload.optunaTrials || 10;
    payload.optunaTrials = trials;
    appendTrainingMonitorLog(trainingMonitorLine(`Optuna TPE: planned ${trials} trial(s)`));
    appendTrainingMonitorLog(trainingMonitorLine("РћС‚РїСЂР°РІРєР° Р·Р°РїСЂРѕСЃР° РЅР° Р·Р°РїСѓСЃРє РѕР±СѓС‡РµРЅРёСЏ"));

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
      setTrainingMonitorStatus("Р—Р°РїСѓСЃРє СЃРѕР·РґР°РЅ, РЅРѕ id РЅРµ РІРµСЂРЅСѓР»СЃСЏ.");
      appendTrainingMonitorLog(trainingMonitorLine("РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ id Р·Р°РїСѓСЃРєР°"));
      showNotice("Р—Р°РїСѓСЃРє СЃРѕР·РґР°РЅ, РЅРѕ id РЅРµ РІРµСЂРЅСѓР»СЃСЏ.", "warning");
      return;
    }

    state.activeRunId = runId;
    state.runTab = "logs";
    state.trainingMonitor.runId = runId;

    setTrainingMonitorStatus("Р—Р°РїСѓСЃРє СЃРѕР·РґР°РЅ");
    appendTrainingMonitorLog(trainingMonitorLine(`Р—Р°РїСѓСЃРє СЃРѕР·РґР°РЅ: ${runId}`));
    showNotice("РћР±СѓС‡РµРЅРёРµ Р·Р°РїСѓС‰РµРЅРѕ.", "success");

    window.location.hash = `#runs/${runId}`;
  } catch (error) {
    const message = error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ AutoML";
    setTrainingMonitorStatus(`РћС€РёР±РєР°: ${message}`);
    appendTrainingMonitorLog(trainingMonitorLine(`РћС€РёР±РєР° Р·Р°РїСѓСЃРєР°: ${message}`));
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
  if (searchAlgSelect) {
    searchAlgSelect.addEventListener("change", toggleHyperparamTypes);
  }
  toggleHyperparamTypes();

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
  setPageMeta("Runs", "РСЃС‚РѕСЂРёСЏ Р·Р°РїСѓСЃРєРѕРІ");

  const sortedRuns = [...state.runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Р’СЃРµ Р·Р°РїСѓСЃРєРё</h2>
            <p class="card-subtitle">Р¤РёР»СЊС‚СЂР°С†РёСЏ Рё РїРµСЂРµС…РѕРґ Рє РґРµС‚Р°Р»СЏРј</p>
          </div>
        </div>

        <div class="filters">
          <div class="form-group">
            <label for="runsDatasetFilter">Р”Р°С‚Р°СЃРµС‚</label>
            <select id="runsDatasetFilter">
              <option value="">Р’СЃРµ</option>
              ${state.datasets
                .map(
                  (dataset) =>
                    `<option value="${escapeHtml(dataset.id)}">${escapeHtml(dataset.name)}</option>`
                )
                .join("")}
            </select>
          </div>

          <div class="form-group">
            <label for="runsStatusFilter">РЎС‚Р°С‚СѓСЃ</label>
            <select id="runsStatusFilter">
              <option value="">Р’СЃРµ</option>
              <option value="running">running</option>
              <option value="finished">finished</option>
              <option value="queued">queued</option>
              <option value="failed">failed</option>
            </select>
          </div>

          <div class="form-group">
            <label for="runsSearch">РџРѕРёСЃРє</label>
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
                            <td>${escapeHtml(run.datasetName || "вЂ”")}</td>
                            <td>${renderStatus(run.status)}</td>
                            <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                            <td>${escapeHtml(formatDateTime(run.finishedAt))}</td>
                            <td>${escapeHtml(run.bestModel || "вЂ”")}</td>
                            <td>${metricValue(run.bestMap, 2)}</td>
                            <td>${escapeHtml(run.device || run.gpu || "вЂ”")}</td>
                            <td>${escapeHtml(run.searchAlgorithm || "вЂ”")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Р—Р°РїСѓСЃРєРѕРІ РїРѕРєР° РЅРµС‚</div>`
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
        ${renderKpi("Best model", escapeHtml(summary.bestModel || "вЂ”"), "Р›РёРґРµСЂ Р·Р°РїСѓСЃРєР°")}
        ${renderKpi("Best mAP", metricValue(summary.bestMap, 2), "РљР°С‡РµСЃС‚РІРѕ")}
        ${renderKpi("Best precision", metricValue(summary.bestPrecision, 2), "Precision")}
        ${renderKpi("Best recall", metricValue(summary.bestRecall, 2), "Recall")}
      </section>

      <section class="grid-2">
        <article class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title" style="font-size:20px;">РЎРІРѕРґРєР° Р·Р°РїСѓСЃРєР°</h3>
              <p class="card-subtitle">РћСЃРЅРѕРІРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹</p>
            </div>
          </div>

          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr><th>Run</th><td>${escapeHtml(detail.id || "вЂ”")}</td></tr>
                <tr><th>Dataset</th><td>${escapeHtml(detail.datasetName || "вЂ”")}</td></tr>
                <tr><th>Status</th><td>${renderStatus(detail.status)}</td></tr>
                <tr><th>Started</th><td>${escapeHtml(formatDateTime(detail.startedAt))}</td></tr>
                <tr><th>Finished</th><td>${escapeHtml(formatDateTime(detail.finishedAt))}</td></tr>
                <tr><th>Metric</th><td>${escapeHtml(detail.targetMetric || "вЂ”")}</td></tr>
                <tr><th>Device</th><td>${escapeHtml(detail.device || detail.gpu || "вЂ”")}</td></tr>
                <tr><th>Search Algorithm</th><td>${escapeHtml(detail.searchAlgorithm || "вЂ”")}</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title" style="font-size:20px;">Р›СѓС‡С€РёРµ РјРѕРґРµР»Рё</h3>
              <p class="card-subtitle">Р РµР·СѓР»СЊС‚Р°С‚С‹ С‚РµРєСѓС‰РµРіРѕ Р·Р°РїСѓСЃРєР°</p>
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
              : `<div class="empty-state">РњРѕРґРµР»Рё РµС‰С‘ РЅРµ РґРѕСЃС‚СѓРїРЅС‹.</div>`
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
          <h3 class="card-title" style="font-size:20px;">РњРѕРґРµР»Рё Рё РїР°СЂР°РјРµС‚СЂС‹</h3>
          <p class="card-subtitle">РС‚РѕРіРѕРІС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕСЃР»Рµ РѕР±СѓС‡РµРЅРёСЏ</p>
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
                    <th>РџР°СЂР°РјРµС‚СЂС‹</th>
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
                                  : `<span class="param-chip">РќРµС‚ РїР°СЂР°РјРµС‚СЂРѕРІ</span>`
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
          : `<div class="empty-state">РќРµС‚ РґР°РЅРЅС‹С… РїРѕ РјРѕРґРµР»СЏРј.</div>`
      }
    </section>
  `;
}

function renderRunEdge(detail) {
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title" style="font-size:20px;">Р“СЂР°С„РёРєРё РѕР±СѓС‡РµРЅРёСЏ</h3>
          <p class="card-subtitle">РСЃС‚РѕСЂРёСЏ РѕР±СѓС‡РµРЅРёСЏ РјРѕРґРµР»РµР№ РґР°РЅРЅРѕРіРѕ Р·Р°РїСѓСЃРєР°</p>
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
          : `<div class="empty-state">Р“СЂР°С„РёРєРё РѕР±СѓС‡РµРЅРёСЏ РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРЅС‹.</div>`
      }
    </section>
  `;
}

function fileNameFromUrl(url, fallback = "best.pt") {
  if (!url) return fallback;
  try {
    const clean = String(url).split("?")[0];
    return decodeURIComponent(clean.split("/").pop() || fallback);
  } catch {
    return fallback;
  }
}


async function renderRunDetailPage(runId) {
  const detail = await ensureRunDetail(runId);
  if (!detail) {
    renderRoot(`<div class="empty-state">Р—Р°РїСѓСЃРє РЅРµ РЅР°Р№РґРµРЅ.</div>`);
    return;
  }

  state.activeRunId = detail.id || runId;
  state.activeDatasetId = detail.datasetId || state.activeDatasetId;

  setPageMeta(`Run #${detail.id || runId}`, "РњРµС‚СЂРёРєРё, РјРѕРґРµР»Рё, РіСЂР°С„РёРєРё Рё Р»РѕРіРё");

  const tab = state.runTab || "overview";

  renderRoot(`
    <div class="page-stack">
      <a href="#runs" class="chip" style="width:max-content;">в†ђ РќР°Р·Р°Рґ Рє Runs</a>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Run #${escapeHtml(detail.id || runId)}</h2>
            <p class="card-subtitle">${escapeHtml(detail.datasetName || "вЂ”")}</p>
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

  if (detail.errorMessage) {
    showNotice(
      detail.status === "finished" ? detail.errorMessage : `РћС€РёР±РєР° Р·Р°РїСѓСЃРєР°: ${detail.errorMessage}`,
      detail.status === "finished" ? "warning" : "error"
    );
  }

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
  setPageMeta("Compare", "РЎСЂР°РІРЅРµРЅРёРµ Р·Р°РїСѓСЃРєРѕРІ РїРѕ РѕРґРЅРѕРјСѓ РґР°С‚Р°СЃРµС‚Сѓ");

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
          <label for="compareDatasetSelect">Р”Р°С‚Р°СЃРµС‚</label>
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

        <div class="helper-text" style="margin-bottom:12px;">Р’С‹Р±РµСЂРёС‚Рµ РЅРµСЃРєРѕР»СЊРєРѕ Р·Р°РїСѓСЃРєРѕРІ.</div>

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
                              ${escapeHtml(run.bestModel || "вЂ”")} В· ${metricValue(run.bestMap, 2)} В· ${escapeHtml(
                              run.device || run.gpu || "вЂ”"
                            )}
                            </div>
                          </span>
                        </label>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-state">Р”Р»СЏ СЌС‚РѕРіРѕ РґР°С‚Р°СЃРµС‚Р° РїРѕРєР° РЅРµС‚ Р·Р°РїСѓСЃРєРѕРІ</div>`
          }
        </div>
      </aside>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">РЎСЂР°РІРЅРµРЅРёРµ Р·Р°РїСѓСЃРєРѕРІ</h2>
            <p class="card-subtitle">РљР°С‡РµСЃС‚РІРѕ, СЃРєРѕСЂРѕСЃС‚СЊ Рё РёС‚РѕРіРѕРІС‹Рµ РїР°СЂР°РјРµС‚СЂС‹</p>
          </div>
        </div>

        ${
          compareItems.length >= 2
            ? `
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>РџР°СЂР°РјРµС‚СЂ</th>
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
                        .map((item) => `<td>${escapeHtml(item.bestModel?.name || "вЂ”")}</td>`)
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
                              item.bestModel?.trainedParams?.device || item.detail.device || "вЂ”"
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
                              String(item.bestModel?.trainedParams?.epochs ?? "вЂ”")
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
                              String(item.bestModel?.trainedParams?.batchSize ?? "вЂ”")
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
                              String(item.bestModel?.trainedParams?.imageSize ?? "вЂ”")
                            )}</td>`
                        )
                        .join("")}
                    </tr>
                    <tr>
                      <td><strong>Optimizer</strong></td>
                      ${compareItems
                        .map(
                          (item) =>
                            `<td>${escapeHtml(item.bestModel?.trainedParams?.optimizer || "вЂ”")}</td>`
                        )
                        .join("")}
                    </tr>
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">Р’С‹Р±РµСЂРёС‚Рµ РјРёРЅРёРјСѓРј РґРІР° Р·Р°РїСѓСЃРєР° РґР»СЏ СЃСЂР°РІРЅРµРЅРёСЏ</div>`
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
  setPageMeta("Exports", "Р’С‹РіСЂСѓР·РєР° РєРѕРЅС„РёРіСѓСЂР°С†РёР№ Р·Р°РїСѓСЃРєРѕРІ");

  const datasetId = state.activeDatasetId || state.datasets[0]?.id || "";
  const filteredRuns = datasetId ? getRunsByDataset(datasetId) : state.runs;

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Р­РєСЃРїРѕСЂС‚ РєРѕРЅС„РёРіСѓСЂР°С†РёР№</h2>
            <p class="card-subtitle">РЎРєР°С‡РёРІР°РЅРёРµ РґР°РЅРЅС‹С… РїРѕ РѕС‚РґРµР»СЊРЅС‹Рј Р·Р°РїСѓСЃРєР°Рј</p>
          </div>
        </div>

        <div class="form-group" style="max-width:360px; margin-bottom:16px;">
          <label for="exportsDatasetSelect">Р”Р°С‚Р°СЃРµС‚</label>
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
                            <div class="dataset-meta">${escapeHtml(run.datasetName || "вЂ”")}</div>
                          </div>
                          ${renderStatus(run.status)}
                        </div>

                        <div class="meta-chips">
                          <span class="chip">Best model: ${escapeHtml(run.bestModel || "вЂ”")}</span>
                          <span class="chip">mAP: ${metricValue(run.bestMap, 2)}</span>
                          <span class="chip">Device: ${escapeHtml(run.device || run.gpu || "вЂ”")}</span>
                        </div>

                        <div class="form-actions" style="margin-top:14px;">
                          <a class="btn btn-primary" href="${buildApiUrl(`/exports/runs/${encodeURIComponent(
                            run.id
                          )}?format=json`)}" download>JSON</a>

                          <a class="btn btn-secondary" href="${buildApiUrl(`/exports/runs/${encodeURIComponent(
                            run.id
                          )}?format=yaml`)}" download>YAML</a>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-state">РќРµС‚ Р·Р°РїСѓСЃРєРѕРІ РґР»СЏ СЌРєСЃРїРѕСЂС‚Р°</div>`
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
  setPageMeta("Settings", "РќР°СЃС‚СЂРѕР№РєРё РІС‹Р±СЂР°РЅРЅРѕРіРѕ РґР°С‚Р°СЃРµС‚Р°");

  const datasetId = state.activeDatasetId || state.datasets[0]?.id || null;
  if (!datasetId) {
    renderRoot(`<div class="empty-state">РќРµС‚ РґР°С‚Р°СЃРµС‚РѕРІ РґР»СЏ РЅР°СЃС‚СЂРѕР№РєРё</div>`);
    return;
  }

  const detail = await ensureDatasetDetail(datasetId);

  renderRoot(`
    <div class="page-stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">РќР°СЃС‚СЂРѕР№РєРё РґР°С‚Р°СЃРµС‚Р°</h2>
            <p class="card-subtitle">РР·РјРµРЅРµРЅРёРµ РїР°СЂР°РјРµС‚СЂРѕРІ РІС‹Р±СЂР°РЅРЅРѕРіРѕ РґР°С‚Р°СЃРµС‚Р°</p>
          </div>
        </div>

        <form id="settingsForm">
          <div class="form-grid">
            <div class="form-group">
              <label for="settingsDataset">Р”Р°С‚Р°СЃРµС‚</label>
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
              <label for="settingsName">РќР°Р·РІР°РЅРёРµ</label>
              <input id="settingsName" name="name" type="text" value="${escapeHtml(detail.name || "")}" />
            </div>
          </div>

          <div class="form-group">
            <label for="settingsDescription">РћРїРёСЃР°РЅРёРµ</label>
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
              <label for="settingsMetric">РњРµС‚СЂРёРєР°</label>
              <select id="settingsMetric" name="targetMetric" ${
                detail.availableMetrics?.length ? "" : "disabled"
              }>
                ${
                  detail.availableMetrics?.length
                    ? optionMarkup(
                        detail.availableMetrics.map((value) => ({ value, label: value })),
                        detail.settings?.targetMetric
                      )
                    : `<option value="">РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… РјРµС‚СЂРёРє</option>`
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
            <button class="btn btn-primary" type="submit">РЎРѕС…СЂР°РЅРёС‚СЊ</button>
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
      showNotice("РќР°СЃС‚СЂРѕР№РєРё СЃРѕС…СЂР°РЅРµРЅС‹. YAML РѕР±РЅРѕРІР»РµРЅ.", "success");
      await renderSettingsPage();
    } catch (error) {
      showNotice(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё.", "error");
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
        ${escapeHtml(error.message || "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С….")}
      </div>
    `);
  }
}

function formatStatusUpdateTime() {
  return new Date().toLocaleTimeString("en-US");
}

function renderAutomlStatusCard() {
  const data = normalizeAutomlStatus(state.automlStatus);

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Model Status</h2>
          <p class="card-subtitle">Live data from status.json via API</p>
        </div>
      </div>

      <div class="grid-4">
        <div class="kpi">
          <div class="kpi-label">Model</div>
          <div class="kpi-value" id="automlStatusModel">${escapeHtml(String(data.modelNumber))}</div>
          <div class="kpi-note">Source: /api/status</div>
        </div>

        <div class="kpi">
          <div class="kpi-label">Total</div>
          <div class="kpi-value" id="automlStatusTotal">${escapeHtml(String(data.totalCount))}</div>
          <div class="kpi-note">Current value</div>
        </div>

        <div class="kpi">
          <div class="kpi-label">Status</div>
          <div class="kpi-value" id="automlStatusValue">${renderStatus(data.status)}</div>
          <div class="kpi-note" id="automlStatusUpdated">Waiting for update...</div>
        </div>

        <div class="kpi">
          <div class="kpi-label">Active Run</div>
          <div class="kpi-value" id="automlStatusRunId">${escapeHtml(String(data.runId || "-"))}</div>
          <div class="kpi-note" id="automlStatusError">${escapeHtml(data.error || "No errors")}</div>
        </div>
      </div>
    </section>
  `;
}

function applyAutomlStatus(data) {
  const normalized = normalizeAutomlStatus(data);
  state.automlStatus = normalized;

  const modelEl = qs("#automlStatusModel");
  const totalEl = qs("#automlStatusTotal");
  const statusEl = qs("#automlStatusValue");
  const updatedEl = qs("#automlStatusUpdated");
  const runIdEl = qs("#automlStatusRunId");
  const errorEl = qs("#automlStatusError");

  if (modelEl) modelEl.textContent = String(normalized.modelNumber);
  if (totalEl) totalEl.textContent = String(normalized.totalCount);
  if (statusEl) statusEl.innerHTML = renderStatus(normalized.status);
  if (runIdEl) runIdEl.textContent = String(normalized.runId || "-");
  if (errorEl) errorEl.textContent = normalized.error || "No errors";

  if (updatedEl) {
    updatedEl.textContent = `Updated: ${formatStatusUpdateTime()}`;
  }
}

function startAutomlStatusPolling() {
  let timerId = null;

  const tick = async () => {
    try {
      const data = await fetchAutomlStatus();
      applyAutomlStatus(data);
    } catch (error) {
      const updatedEl = qs("#automlStatusUpdated");
      if (updatedEl) {
        updatedEl.textContent = `Error: ${error.message}`;
      }
    }
  };

  tick();
  timerId = setInterval(tick, STATUS_POLL_INTERVAL_MS);

  return () => {
    if (timerId) clearInterval(timerId);
  };
}

function applyCompletedRunArtifacts(runDetail) {
  const block = qs("#runArtifactsBlock");
  const chart = qs("#resultChart");
  const link = qs("#downloadModel");
  const artifacts = runDetail?.artifacts || {};
  const chartUrl = artifacts.resultsPlotUrl ? buildStaticUrl(artifacts.resultsPlotUrl) : "";
  const modelUrl = artifacts.bestModelUrl || artifacts.lastModelUrl || "";

  if (block) {
    block.hidden = !chartUrl && !modelUrl;
  }

  if (chart) {
    chart.hidden = !chartUrl;
    if (chartUrl) {
      chart.src = `${chartUrl}${chartUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
    } else {
      chart.removeAttribute("src");
    }
  }

  if (link) {
    link.hidden = !modelUrl;
    if (modelUrl) {
      const downloadName = fileNameFromUrl(modelUrl);
      link.href = buildStaticUrl(modelUrl);
      link.setAttribute("download", downloadName);
      link.textContent = `Download ${downloadName}`;
    }
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
      const loadingText = "Loading logs...";
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
      state.runDetails[String(runId)] = runDetail;
      const currentStatus = String(runDetail?.status || "").toLowerCase();
      const isCompletedStatus = ["completed", "finished"].includes(currentStatus);
      const isErrorStatus = ["failed", "error"].includes(currentStatus);

      if (isCompletedStatus) {
        applyCompletedRunArtifacts(runDetail);
        artifactsApplied = true;

        const completedText = "Training completed";
        if (statusEl) statusEl.textContent = completedText;
        pushUpdate({ statusText: completedText, completed: true });

        refreshCoreData().catch(() => {});

        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }

        return;
      }

      if (isErrorStatus) {
        const failureMessage = runDetail?.errorMessage || "Training finished with an error";
        const failedText = `Error: ${failureMessage}`;
        if (statusEl) statusEl.textContent = failedText;
        pushUpdate({ statusText: failedText, error: true });
        showNotice(failureMessage, "error");

        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }

        return;
      }

      const updatedText = `Updated: ${formatStatusUpdateTime()}`;
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
      const errorText = `Error: ${error.message}`;
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
          <h3 class="card-title" style="font-size:20px;">Run Logs</h3>
          <p class="card-subtitle">Live log stream for the selected run</p>
        </div>
      </div>

      <textarea id="runLogsTextarea" class="logs-box" readonly spellcheck="false"></textarea>
      <div id="runLogsStatus" class="logs-status"></div>

      <div id="runArtifactsBlock" hidden style="margin-top:16px;">
        <div class="chart-grid">
          <article class="chart-card">
            <div class="chart-title">Training Chart</div>
            <img
              id="resultChart"
              src=""
              alt="Training chart"
              style="display:block; width:100%; max-width:100%; border-radius:16px; border:1px solid var(--line); background:#fff;"
            />
          </article>

          <article class="chart-card">
            <div class="chart-title">Model Weights</div>
            <a
              id="downloadModel"
              href="#"
              download="best.pt"
              class="btn btn-primary artifact-download-btn"
            >
              Download best.pt
            </a>
          </article>
        </div>
      </div>
    </section>
  `;
}

async function bootstrap() {
  try {
    setLoading("Р—Р°РіСЂСѓР·РєР° РґР°РЅРЅС‹С…...");
    await refreshCoreData();

    qs("#refreshButton")?.addEventListener("click", async () => {
      try {
        setLoading("РћР±РЅРѕРІР»РµРЅРёРµ...");
        state.datasetDetails = {};
        state.runDetails = {};
        await refreshCoreData();
        await route();
      } catch (error) {
        showNotice(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РґР°РЅРЅС‹Рµ.", "error");
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
        ${escapeHtml(error.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РёРЅРёС†РёР°Р»РёР·РёСЂРѕРІР°С‚СЊ РёРЅС‚РµСЂС„РµР№СЃ.")}
      </div>
    `);
  }
}

let appBootstrapStarted = false;

function startAppOnce() {
  if (appBootstrapStarted) return;
  appBootstrapStarted = true;
  bootstrap();
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AUTOML_APP_BOOTSTRAP_BOUND__) {
  window.__AUTOML_APP_BOOTSTRAP_BOUND__ = true;

  window.formToJSON = formToJSON;
  window.fetchLogs = fetchLogs;
  window.renderLogsWithAutoscroll = renderLogsWithAutoscroll;
  window.startLogsPolling = startLogsPolling;
  window.addHyperparamRow = addHyperparamRow;
  window.removeHyperparamRow = removeHyperparamRow;

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startAppOnce);
  } else {
    startAppOnce();
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    bootstrap,
    formToJSON,
    fetchLogs,
    renderLogsWithAutoscroll,
    startLogsPolling,
    serializeForm,
    fetchAutomlStatus,
    startAutomlStatusPolling,
    normalizeAutomlStatus,
    applyAutomlStatus,
    fileNameFromUrl,
    };
}

