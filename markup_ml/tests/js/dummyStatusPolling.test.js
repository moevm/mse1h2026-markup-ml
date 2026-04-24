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

function errorResponse(status) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ detail: `HTTP ${status}` }),
    text: async () => `HTTP ${status}`,
  });
}

function createDashboardFetchMock(statusFactory) {
  return jest.fn((request) => {
    const key = String(request);

    if (key.includes("/api/dashboard")) {
      return jsonResponse({
        summary: {
          datasetsCount: 1,
          runsCount: 1,
          runningCount: 1,
          queuedCount: 0,
        },
        topDatasets: [
          {
            id: "ds-1",
            name: "Dataset 1",
            taskType: "detection",
            samples: 120,
            status: "ready",
            bestModel: "YOLOv8n",
            bestMap: 0.81,
          },
        ],
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
        },
      ]);
    }

    if (key.includes("/api/runs")) {
      return jsonResponse([
        {
          id: "run-1",
          datasetId: "ds-1",
          datasetName: "Dataset 1",
          status: "running",
          startedAt: "2026-03-13T10:00:00.000Z",
          bestModel: "YOLOv8n",
          bestMap: 0.81,
          device: "gpu0",
        },
      ]);
    }

    if (key.includes("/api/status")) {
      return statusFactory(key);
    }

    return Promise.reject(new Error(`Unexpected fetch: ${key}`));
  });
}

describe("automl status polling", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("dashboard renders data from /api/status", async () => {
    const fetchMock = createDashboardFetchMock(() =>
      jsonResponse({
        current_model: "YOLOv8n",
        total_models: 128,
        status: "running",
        runId: "run-1",
        error: null,
      })
    );

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("automlStatusModel") !== null);

    expect(document.getElementById("automlStatusModel").textContent).toBe("YOLOv8n");
    expect(document.getElementById("automlStatusTotal").textContent).toBe("128");
    expect(document.getElementById("automlStatusValue").textContent.toLowerCase()).toContain("running");
    expect(document.getElementById("automlStatusRunId").textContent).toBe("run-1");
    expect(document.getElementById("automlStatusUpdated").textContent).toContain("Updated:");
  });

  test("dashboard updates status every 3 seconds", async () => {
    jest.useFakeTimers();

    let statusRequestCount = 0;

    const fetchMock = createDashboardFetchMock(() => {
      statusRequestCount += 1;

      if (statusRequestCount === 1) {
        return jsonResponse({
          current_model: "YOLOv8n",
          total_models: 128,
          status: "running",
        });
      }

      return jsonResponse({
        current_model: "YOLOv11m",
        total_models: 256,
        status: "finished",
      });
    });

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("automlStatusModel") !== null);

    expect(document.getElementById("automlStatusModel").textContent).toBe("YOLOv8n");
    expect(document.getElementById("automlStatusTotal").textContent).toBe("128");
    expect(document.getElementById("automlStatusValue").textContent.toLowerCase()).toContain("running");

    jest.advanceTimersByTime(3000);
    await flushMicrotasks(20);

    await waitFor(() =>
      document.getElementById("automlStatusModel")?.textContent === "YOLOv11m"
    );

    expect(document.getElementById("automlStatusTotal").textContent).toBe("256");
    expect(document.getElementById("automlStatusValue").textContent.toLowerCase()).toContain("finished");
  });

  test("dashboard shows error when /api/status is unavailable", async () => {
    const fetchMock = createDashboardFetchMock(() => errorResponse(500));

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("automlStatusUpdated") !== null);

    expect(document.getElementById("automlStatusUpdated").textContent).toContain("HTTP 500");
  });
});
