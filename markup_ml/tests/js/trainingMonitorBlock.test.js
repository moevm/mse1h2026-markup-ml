const {
  bootstrapApp,
  flushMicrotasks,
  waitFor,
} = require("./testUtils");

function jsonResponse(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function createDatasetsPageFetchMock() {
  return jest.fn((request) => {
    const key = String(request);

    if (key.includes("/api/dashboard")) {
      return jsonResponse({
        summary: {
          datasetsCount: 1,
          runsCount: 1,
          runningCount: 0,
          queuedCount: 0,
        },
        topDatasets: [],
      });
    }

    if (key.includes("/api/datasets/ds-1/runs")) {
      return jsonResponse({
        runId: "run-55",
      });
    }

    if (key.includes("/api/datasets/ds-1")) {
      return jsonResponse({
        id: "ds-1",
        name: "Dataset 1",
        description: "Test dataset",
        status: "ready",
        samples: 120,
        classesCount: 3,
        bestModel: "YOLOv8n",
        bestMap: 0.81,
        availableMetrics: ["map"],
        availableDevices: ["auto", "gpu0", "cpu"],
        yamlPath: "datasets/ds-1/data.yaml",
        yamlContent: "train: images/train\nval: images/val\nnc: 1\nnames: [obj]\n",
        settings: {
          targetMetric: "map",
          device: "auto",
          budget: 10,
        },
        bestModels: [],
      });
    }

    if (key.includes("/api/datasets")) {
      return jsonResponse([
        {
          id: "ds-1",
          name: "Dataset 1",
          taskType: "detection",
          samples: 120,
          status: "ready",
          bestModel: "YOLOv8n",
          bestMap: 0.81,
          lastRunAt: "2026-03-13T10:00:00.000Z",
        },
      ]);
    }

    if (key.includes("/api/runs")) {
      return jsonResponse([
        {
          id: "run-55",
          datasetId: "ds-1",
          datasetName: "Dataset 1",
          status: "running",
          startedAt: "2026-03-13T10:00:00.000Z",
          finishedAt: null,
          bestModel: "YOLOv8n",
          bestMap: 0.81,
          budget: 10,
          device: "gpu0",
        },
      ]);
    }

    return Promise.reject(new Error(`Unexpected fetch: ${key}`));
  });
}

describe("training monitor block", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("блок мониторинга скрыт по умолчанию", async () => {
    const fetchMock = createDatasetsPageFetchMock();

    await bootstrapApp({ hash: "#datasets", fetchMock });
    await flushMicrotasks(20);

    const block = document.getElementById("datasetTrainingMonitor");
    const textarea = document.getElementById("datasetTrainingLogsTextarea");

    expect(block).not.toBeNull();
    expect(block.hidden).toBe(true);

    expect(textarea).not.toBeNull();
    expect(textarea.readOnly).toBe(true);
    expect(textarea.style.height).toBe("220px");
  });

  test("после submit блок активируется и затем происходит переход на страницу запуска", async () => {
    const fetchMock = createDatasetsPageFetchMock();

    await bootstrapApp({ hash: "#datasets", fetchMock });
    await flushMicrotasks(20);

    const form = document.getElementById("launchRunForm");
    const button = form.querySelector('button[type="submit"]');
    const block = document.getElementById("datasetTrainingMonitor");
    const status = document.getElementById("datasetTrainingLogsStatus");
    const textarea = document.getElementById("datasetTrainingLogsTextarea");

    expect(form).not.toBeNull();
    expect(button).not.toBeNull();
    expect(block.hidden).toBe(true);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(button.disabled).toBe(true);
    expect(block.hidden).toBe(false);
    expect(textarea.readOnly).toBe(true);
    expect(status.textContent.length).toBeGreaterThan(0);

    await flushMicrotasks(30);
    await waitFor(() => window.location.hash === "#runs/run-55");
  });
});