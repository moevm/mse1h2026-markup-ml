const pathToApp = "../../static/app.js";

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(JSON.stringify(data)),
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

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

async function waitFor(check, { attempts = 30 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await flushMicrotasks(8);
    if (check()) return;
  }
  throw new Error("waitFor timeout");
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

function createApiMock() {
  const datasets = [
    {
      id: "ds-1",
      name: "Retail Detection",
      description: "Retail dataset",
      taskType: "detection",
      samples: 1200,
      status: "ready",
      bestModel: null,
      bestMap: null,
      lastRunAt: null,
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
      bestModel: null,
      bestMap: null,
      availableMetrics: ["mAP@50", "mAP@50-95"],
      availableDevices: ["auto", "gpu0", "gpu1", "cpu"],
      settings: {
        targetMetric: "mAP@50",
        budget: 20,
        device: "auto",
        priority: "normal",
      },
      bestModels: [],
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
      ],
      edgeCharts: [],
    },
  };

  return jest.fn(async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const normalizedUrl = String(url);

    if (normalizedUrl === "/api/dashboard" && method === "GET") {
      return jsonResponse({
        summary: {
          datasetsCount: datasets.length,
          runsCount: runs.length,
          runningCount: runs.filter((run) => run.status === "running").length,
          queuedCount: runs.filter((run) => run.status === "queued").length,
        },
        topDatasets: datasets,
      });
    }

    if (normalizedUrl === "/api/datasets" && method === "GET") {
      return jsonResponse(datasets);
    }

    if (normalizedUrl === "/api/runs" && method === "GET") {
      return jsonResponse(runs);
    }

    if (normalizedUrl === "/api/datasets/ds-1" && method === "GET") {
      return jsonResponse(datasetDetails["ds-1"]);
    }

    if (normalizedUrl === "/api/runs/run-1" && method === "GET") {
      return jsonResponse(runDetails["run-1"]);
    }

    if (normalizedUrl === "/api/runs/run-1/logs" && method === "GET") {
      return textResponse("run-1 logs");
    }

    if (normalizedUrl === "/api/datasets/ds-1/runs" && method === "POST") {
      const payload = JSON.parse(options.body);
      const newRunId = "run-2";

      runs.unshift({
        id: newRunId,
        datasetId: "ds-1",
        datasetName: "Retail Detection",
        status: "running",
        startedAt: "2026-03-12T10:00:00Z",
        finishedAt: null,
        bestModel: null,
        bestMap: null,
        budget: payload.budget,
        device: payload.device,
      });

      runDetails[newRunId] = {
        id: newRunId,
        datasetId: "ds-1",
        datasetName: "Retail Detection",
        status: "running",
        startedAt: "2026-03-12T10:00:00Z",
        finishedAt: null,
        targetMetric: payload.targetMetric,
        budget: payload.budget,
        device: payload.device,
        summary: {
          bestModel: null,
          bestMap: null,
          bestPrecision: null,
          bestRecall: null,
        },
        models: [],
        edgeCharts: [],
      };

      return jsonResponse({ runId: newRunId });
    }

    if (normalizedUrl === "/api/runs/run-2" && method === "GET") {
      return jsonResponse(runDetails["run-2"]);
    }

    if (normalizedUrl === "/api/runs/run-2/logs" && method === "GET") {
      return textResponse("run-2 logs");
    }

    throw new Error(`Unexpected fetch: ${method} ${normalizedUrl}`);
  });
}

describe("mockStartTraining", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("резолвится статусом started через 1 секунду", async () => {
    const { mockStartTraining } = require(pathToApp);

    let resolved = false;
    let value;

    const p = mockStartTraining({ a: 1 }).then((v) => {
      resolved = true;
      value = v;
    });

    jest.advanceTimersByTime(999);
    await flushMicrotasks();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(1);
    await p;

    expect(value).toEqual({ status: "started" });
  });
});

describe("dataset launch flow", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete window.__AUTOML_APP_BOOTSTRAP_BOUND__;
    window.location.hash = "#datasets";
    mountAppShell();
    global.fetch = createApiMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("кнопка запуска блокируется сразу после submit, затем открывается страница запуска", async () => {
  const { bootstrap } = require(pathToApp);

  await bootstrap();
  await flushMicrotasks(10);

  const form = document.getElementById("launchRunForm");
  expect(form).not.toBeNull();

  const button = form.querySelector('button[type="submit"]');
  expect(button.disabled).toBe(false);

  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  expect(button.disabled).toBe(true);

  await waitFor(() => window.location.hash === "#runs/run-2");

  window.dispatchEvent(new Event("hashchange"));
  await flushMicrotasks(10);

  expect(document.getElementById("page-title").textContent).toBe("Run #run-2");
  expect(document.body.textContent).toContain("Run #run-2");
  });
});