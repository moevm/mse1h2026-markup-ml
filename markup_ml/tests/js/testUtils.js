const pathToApp = "../../static/app.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => deepClone(data),
    text: async () => JSON.stringify(data),
  };
}

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => ({ text }),
  };
}

function createBaseState() {
  const datasets = [
    {
      id: "ds-1",
      name: "Retail Detection",
      description: "Retail dataset",
      taskType: "detection",
      samples: 1200,
      status: "ready",
      bestModel: "yolo-s",
      bestMap: 0.81,
      lastRunAt: "2026-02-09T09:18:00Z",
    },
    {
      id: "ds-2",
      name: "Traffic Objects",
      description: "Traffic dataset",
      taskType: "detection",
      samples: 2400,
      status: "ready",
      bestModel: "yolo-m",
      bestMap: 0.84,
      lastRunAt: "2026-02-10T13:40:00Z",
    },
  ];

  const datasetDetails = {
    "ds-1": {
      id: "ds-1",
      name: "Retail Detection",
      description: "Retail dataset",
      taskType: "detection",
      samples: 1200,
      classesCount: 2,
      classes: ["person", "box"],
      status: "ready",
      bestModel: "yolo-s",
      bestMap: 0.81,
      availableMetrics: ["mAP@50", "mAP@50-95"],
      availableDevices: ["auto", "gpu0", "gpu1", "cpu"],
      availablePriorities: ["normal", "high", "low"],
      settings: {
        targetMetric: "mAP@50",
        budget: 20,
        device: "auto",
        priority: "normal",
      },
      yamlPath: "/app/datasets/retail/data.yaml",
      yamlContent: "path: /app/datasets/retail\ntrain: train/images\nval: val/images\nnc: 2\nnames: [person, box]\n",
      bestModels: [
        { name: "yolo-s", map: 0.81, fps: 62, sizeMb: 22 },
        { name: "yolo-m", map: 0.79, fps: 44, sizeMb: 48 },
      ],
    },
    "ds-2": {
      id: "ds-2",
      name: "Traffic Objects",
      description: "Traffic dataset",
      taskType: "detection",
      samples: 2400,
      classesCount: 3,
      classes: ["car", "person", "bus"],
      status: "ready",
      bestModel: "yolo-m",
      bestMap: 0.84,
      availableMetrics: ["mAP@50", "mAP@50-95", "Recall"],
      availableDevices: ["auto", "gpu0", "gpu1", "cpu"],
      availablePriorities: ["normal", "high", "low"],
      settings: {
        targetMetric: "mAP@50-95",
        budget: 24,
        device: "gpu0",
        priority: "normal",
      },
      yamlPath: "/app/datasets/traffic/data.yaml",
      yamlContent: "path: /app/datasets/traffic\ntrain: train/images\nval: val/images\nnc: 3\nnames: [car, person, bus]\n",
      bestModels: [
        { name: "yolo-m", map: 0.84, fps: 41, sizeMb: 48 },
        { name: "yolo-s", map: 0.80, fps: 60, sizeMb: 22 },
      ],
    },
  };

  const runs = [
    {
      id: "run-1",
      datasetId: "ds-1",
      datasetName: "Retail Detection",
      status: "finished",
      startedAt: "2026-02-09T08:30:00Z",
      finishedAt: "2026-02-09T09:18:00Z",
      bestModel: "yolo-s",
      bestMap: 0.81,
      budget: 20,
      device: "gpu0",
    },
    {
      id: "run-2",
      datasetId: "ds-1",
      datasetName: "Retail Detection",
      status: "finished",
      startedAt: "2026-02-08T10:00:00Z",
      finishedAt: "2026-02-08T11:00:00Z",
      bestModel: "yolo-m",
      bestMap: 0.79,
      budget: 16,
      device: "gpu1",
    },
    {
      id: "run-3",
      datasetId: "ds-2",
      datasetName: "Traffic Objects",
      status: "running",
      startedAt: "2026-02-10T13:00:00Z",
      finishedAt: null,
      bestModel: "yolo-m",
      bestMap: 0.84,
      budget: 24,
      device: "gpu0",
    },
  ];

  const runDetails = {
    "run-1": {
      id: "run-1",
      datasetId: "ds-1",
      datasetName: "Retail Detection",
      status: "finished",
      startedAt: "2026-02-09T08:30:00Z",
      finishedAt: "2026-02-09T09:18:00Z",
      targetMetric: "mAP@50",
      budget: 20,
      device: "gpu0",
      searchAlgorithm: "OptunaTPE",
      errorMessage: null,
      artifacts: {
        bestModelUrl: "/runs/detect/run-1/trial_000/weights/best.pt",
        lastModelUrl: "/runs/detect/run-1/trial_000/weights/last.pt",
        resultsPlotUrl: "/runs/detect/run-1/trial_000/results.png",
      },
      summary: {
        bestModel: "yolo-s",
        bestMap: 0.81,
        bestPrecision: 0.84,
        bestRecall: 0.78,
      },
      models: [
        {
          name: "yolo-s",
          mAP: 0.81,
          precision: 0.84,
          recall: 0.78,
          fps: 62,
          sizeMb: 22,
          trainedParams: {
            epochs: 18,
            batchSize: 16,
            imageSize: 640,
            optimizer: "AdamW",
            device: "gpu0",
          },
        },
        {
          name: "yolo-m",
          mAP: 0.79,
          precision: 0.82,
          recall: 0.76,
          fps: 44,
          sizeMb: 48,
          trainedParams: {
            epochs: 20,
            batchSize: 8,
            imageSize: 960,
            optimizer: "SGD",
            device: "gpu0",
          },
        },
      ],
      edgeCharts: [
        {
          model: "yolo-s",
          history: {
            loss: [1.08, 0.97, 0.88, 0.73, 0.61, 0.49, 0.41, 0.34],
            map: [0.31, 0.38, 0.49, 0.57, 0.66, 0.72, 0.77, 0.81],
            precision: [0.40, 0.49, 0.57, 0.65, 0.72, 0.77, 0.81, 0.84],
            recall: [0.33, 0.40, 0.47, 0.55, 0.63, 0.69, 0.74, 0.78],
          },
        },
      ],
    },
    "run-2": {
      id: "run-2",
      datasetId: "ds-1",
      datasetName: "Retail Detection",
      status: "finished",
      startedAt: "2026-02-08T10:00:00Z",
      finishedAt: "2026-02-08T11:00:00Z",
      targetMetric: "mAP@50",
      budget: 16,
      device: "gpu1",
      searchAlgorithm: "OptunaTPE",
      errorMessage: null,
      artifacts: {
        bestModelUrl: "/runs/detect/run-2/trial_000/weights/best.pt",
        lastModelUrl: "/runs/detect/run-2/trial_000/weights/last.pt",
        resultsPlotUrl: "/runs/detect/run-2/trial_000/results.png",
      },
      summary: {
        bestModel: "yolo-m",
        bestMap: 0.79,
        bestPrecision: 0.82,
        bestRecall: 0.76,
      },
      models: [
        {
          name: "yolo-m",
          mAP: 0.79,
          precision: 0.82,
          recall: 0.76,
          fps: 44,
          sizeMb: 48,
          trainedParams: {
            epochs: 20,
            batchSize: 8,
            imageSize: 960,
            optimizer: "SGD",
            device: "gpu1",
          },
        },
      ],
      edgeCharts: [],
    },
    "run-3": {
      id: "run-3",
      datasetId: "ds-2",
      datasetName: "Traffic Objects",
      status: "running",
      startedAt: "2026-02-10T13:00:00Z",
      finishedAt: null,
      targetMetric: "mAP@50-95",
      budget: 24,
      device: "gpu0",
      searchAlgorithm: "OptunaTPE",
      errorMessage: null,
      artifacts: {
        bestModelUrl: null,
        lastModelUrl: null,
        resultsPlotUrl: null,
      },
      summary: {
        bestModel: "yolo-m",
        bestMap: 0.84,
        bestPrecision: 0.86,
        bestRecall: 0.80,
      },
      models: [
        {
          name: "yolo-m",
          mAP: 0.84,
          precision: 0.86,
          recall: 0.80,
          fps: 41,
          sizeMb: 48,
          trainedParams: {
            epochs: 22,
            batchSize: 8,
            imageSize: 960,
            optimizer: "AdamW",
            device: "gpu0",
          },
        },
      ],
      edgeCharts: [
        {
          model: "yolo-m",
          history: {
            loss: [1.02, 0.95, 0.82, 0.70, 0.59, 0.50, 0.42, 0.36],
            map: [0.36, 0.42, 0.50, 0.59, 0.67, 0.74, 0.80, 0.84],
            precision: [0.44, 0.50, 0.59, 0.67, 0.74, 0.79, 0.83, 0.86],
            recall: [0.35, 0.41, 0.49, 0.57, 0.64, 0.71, 0.76, 0.80],
          },
        },
      ],
    },
  };

  const runLogs = {
    "run-1": "run-1 logs",
    "run-2": "run-2 logs",
    "run-3": "run-3 logs",
  };

  const statusPayload = {
    current_model: 1,
    total_models: 3,
    status: "running",
    runId: "run-3",
    error: null,
    updatedAt: "2026-02-10T13:05:00Z",
  };

  return {
    datasets,
    datasetDetails,
    runs,
    runDetails,
    runLogs,
    statusPayload,
    nextDatasetIndex: 3,
    nextRunIndex: 4,
  };
}

function updateDatasetSummary(state, datasetId) {
  const detail = state.datasetDetails[datasetId];
  const summary = {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    taskType: detail.taskType,
    samples: detail.samples,
    status: detail.status,
    bestModel: detail.bestModel,
    bestMap: detail.bestMap,
    lastRunAt: detail.lastRunAt,
  };

  const idx = state.datasets.findIndex((item) => item.id === datasetId);
  if (idx >= 0) {
    state.datasets[idx] = summary;
  } else {
    state.datasets.push(summary);
  }
}

function createApiMock() {
  const state = createBaseState();

  const fetchMock = jest.fn(async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const normalizedUrl = String(url);

    if (normalizedUrl === "/api/dashboard" && method === "GET") {
      return jsonResponse({
        summary: {
          datasetsCount: state.datasets.length,
          runsCount: state.runs.length,
          runningCount: state.runs.filter((run) => run.status === "running").length,
          queuedCount: state.runs.filter((run) => run.status === "queued").length,
        },
        topDatasets: state.datasets,
      });
    }

    if (normalizedUrl.startsWith("/api/status") && method === "GET") {
      return jsonResponse({
        ...state.statusPayload,
        modelNumber: state.statusPayload.current_model,
        totalCount: state.statusPayload.total_models,
      });
    }

    if (normalizedUrl === "/api/datasets" && method === "GET") {
      return jsonResponse(state.datasets);
    }

    if (normalizedUrl === "/api/runs" && method === "GET") {
      return jsonResponse(state.runs);
    }

    const datasetRunMatch = normalizedUrl.match(/^\/api\/datasets\/([^/]+)\/runs$/);
    if (datasetRunMatch && method === "POST") {
      const datasetId = datasetRunMatch[1];
      const payload = JSON.parse(options.body);
      const newRunId = `run-${state.nextRunIndex++}`;
      const dataset = state.datasetDetails[datasetId];

      const detail = {
        id: newRunId,
        datasetId,
        datasetName: dataset.name,
        status: "running",
        startedAt: "2026-03-12T10:00:00Z",
        finishedAt: null,
        targetMetric: payload.targetMetric,
        budget: payload.budget,
        device: payload.device,
        searchAlgorithm: payload.searchAlg,
        notes: payload.notes,
        errorMessage: null,
        artifacts: {
          bestModelUrl: null,
          lastModelUrl: null,
          resultsPlotUrl: null,
        },
        summary: {
          bestModel: null,
          bestMap: null,
          bestPrecision: null,
          bestRecall: null,
        },
        models: [],
        edgeCharts: [],
      };

      state.runDetails[newRunId] = detail;
      state.runs.unshift({
        id: newRunId,
        datasetId,
        datasetName: dataset.name,
        status: "running",
        startedAt: detail.startedAt,
        finishedAt: null,
        bestModel: null,
        bestMap: null,
        budget: payload.budget,
        device: payload.device,
      });

      state.runLogs[newRunId] = `Run created: ${newRunId}`;
      dataset.lastRunAt = detail.startedAt;
      dataset.status = "running";
      state.statusPayload = {
        current_model: 0,
        total_models: 0,
        status: "queued",
        runId: newRunId,
        error: null,
        updatedAt: "2026-03-12T10:00:00Z",
      };
      updateDatasetSummary(state, datasetId);

      return jsonResponse({
        runId: newRunId,
        statusUrl: "/api/status",
        runUrl: `/api/runs/${newRunId}`,
      });
    }

    const datasetSettingsMatch = normalizedUrl.match(/^\/api\/datasets\/([^/]+)\/settings$/);
    if (datasetSettingsMatch && method === "PUT") {
      const datasetId = datasetSettingsMatch[1];
      const payload = JSON.parse(options.body);
      const dataset = state.datasetDetails[datasetId];

      dataset.name = payload.name;
      dataset.description = payload.description;
      dataset.settings = {
        targetMetric: payload.targetMetric,
        budget: payload.budget,
        device: payload.device,
        priority: payload.priority,
      };

      updateDatasetSummary(state, datasetId);

      return jsonResponse({ status: "ok" });
    }

    if (normalizedUrl === "/api/datasets" && method === "POST") {
      const formData = options.body;
      const displayName = formData.get("displayName");
      const taskType = formData.get("taskType");
      const description = formData.get("description");
      const datasetFile = formData.get("datasetFile");
      const datasetSource = String(formData.get("datasetSource") || "").trim();

      const newDatasetId = `ds-${state.nextDatasetIndex++}`;
      state.datasetDetails[newDatasetId] = {
        id: newDatasetId,
        name: displayName,
        description,
        taskType,
        samples: 0,
        classesCount: 0,
        classes: [],
        status: "ready",
        bestModel: null,
        bestMap: null,
        lastRunAt: null,
        availableMetrics: ["mAP@50", "mAP@50-95", "F1"],
        availableDevices: ["auto", "gpu0", "gpu1", "cpu"],
        availablePriorities: ["normal", "high", "low"],
        settings: {
          targetMetric: "",
          budget: null,
          device: "auto",
          priority: "normal",
        },
        yamlPath: datasetSource ? `/app/datasets/${datasetSource}/data.yaml` : "/app/datasets/new-dataset/data.yaml",
        yamlContent: "path: /app/datasets/new-dataset\ntrain: train/images\nval: val/images\nnc: 1\nnames: [class_0]\n",
        bestModels: [],
        sourceFilename: datasetFile?.name || datasetSource || null,
      };

      updateDatasetSummary(state, newDatasetId);

      return jsonResponse({
        id: newDatasetId,
        filename: datasetFile?.name || datasetSource || "dataset.zip",
        yamlReady: true,
      });
    }

    const datasetMatch = normalizedUrl.match(/^\/api\/datasets\/([^/]+)$/);
    if (datasetMatch && method === "GET") {
      const datasetId = datasetMatch[1];
      if (!state.datasetDetails[datasetId]) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ detail: "Dataset not found" }),
        };
      }
      return jsonResponse(state.datasetDetails[datasetId]);
    }

    const runLogsMatch = normalizedUrl.match(/^\/api\/runs\/([^/]+)\/logs$/);
    if (runLogsMatch && method === "GET") {
      const runId = runLogsMatch[1];
      return textResponse(state.runLogs[runId] || "");
    }

    const runMatch = normalizedUrl.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      const runId = runMatch[1];
      if (!state.runDetails[runId]) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ detail: "Run not found" }),
        };
      }
      return jsonResponse(state.runDetails[runId]);
    }

    throw new Error(`Unexpected fetch: ${method} ${normalizedUrl}`);
  });

  fetchMock.__state = state;
  return fetchMock;
}

function mountAppShell() {
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <nav class="sidebar-nav">
          <a href="#dashboard" class="nav-link" data-route="dashboard">Dashboard</a>
          <a href="#datasets" class="nav-link" data-route="datasets">Datasets</a>
          <a href="#runs" class="nav-link" data-route="runs">Runs</a>
          <a href="#compare" class="nav-link" data-route="compare">Compare</a>
          <a href="#exports" class="nav-link" data-route="exports">Exports</a>
          <a href="#settings" class="nav-link" data-route="settings">Settings</a>
        </nav>
      </aside>

      <main class="app-main">
        <header class="topbar">
          <div>
            <h1 id="page-title"></h1>
            <p id="page-subtitle"></p>
          </div>
          <div class="topbar-actions">
            <button id="refreshButton" type="button">Обновить</button>
          </div>
        </header>

        <section id="app-notice"></section>
        <section id="app-root" class="page-root"></section>
      </main>
    </div>
  `;
}

async function flushMicrotasks(n = 8) {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

async function waitFor(check, { attempts = 40 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await flushMicrotasks(10);
    if (check()) return;
  }
  throw new Error("waitFor timeout");
}

async function bootstrapApp({ hash = "#dashboard", fetchMock = createApiMock() } = {}) {
  jest.resetModules();
  delete window.__AUTOML_APP_BOOTSTRAP_BOUND__;
  window.location.hash = hash;
  mountAppShell();
  global.fetch = fetchMock;

  const app = require(pathToApp);
  await app.bootstrap();
  await flushMicrotasks(12);

  return { app, fetchMock };
}

module.exports = {
  createApiMock,
  mountAppShell,
  flushMicrotasks,
  waitFor,
  bootstrapApp,
};
