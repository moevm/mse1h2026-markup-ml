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

function createDashboardFetchMock(dummyStatusFactory) {
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

    if (key.includes("dummy_status.json")) {
      return dummyStatusFactory(key);
    }

    return Promise.reject(new Error(`Unexpected fetch: ${key}`));
  });
}

describe("dummy status polling", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("dashboard отображает данные из dummy_status.json", async () => {
    const fetchMock = createDashboardFetchMock(() =>
      jsonResponse({
        modelNumber: "YOLOv8n",
        totalCount: 128,
        status: "running",
      })
    );

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("dummyStatusModel") !== null);

    expect(document.getElementById("dummyStatusModel").textContent).toBe("YOLOv8n");
    expect(document.getElementById("dummyStatusTotal").textContent).toBe("128");
    expect(document.getElementById("dummyStatusValue").textContent.toLowerCase()).toContain("running");
    expect(document.getElementById("dummyStatusUpdated").textContent).toContain("Обновлено:");
  });

  test("dashboard обновляет статус по таймеру каждые 3 секунды", async () => {
    jest.useFakeTimers();

    let dummyRequestCount = 0;

    const fetchMock = createDashboardFetchMock(() => {
      dummyRequestCount += 1;

      if (dummyRequestCount === 1) {
        return jsonResponse({
          modelNumber: "YOLOv8n",
          totalCount: 128,
          status: "running",
        });
      }

      return jsonResponse({
        modelNumber: "YOLOv11m",
        totalCount: 256,
        status: "finished",
      });
    });

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("dummyStatusModel") !== null);

    expect(document.getElementById("dummyStatusModel").textContent).toBe("YOLOv8n");
    expect(document.getElementById("dummyStatusTotal").textContent).toBe("128");
    expect(document.getElementById("dummyStatusValue").textContent.toLowerCase()).toContain("running");

    jest.advanceTimersByTime(3000);
    await flushMicrotasks(20);

    await waitFor(() =>
      document.getElementById("dummyStatusModel")?.textContent === "YOLOv11m"
    );

    expect(document.getElementById("dummyStatusTotal").textContent).toBe("256");
    expect(document.getElementById("dummyStatusValue").textContent.toLowerCase()).toContain("finished");
  });

  test("dashboard показывает ошибку, если dummy_status.json недоступен", async () => {
    const fetchMock = createDashboardFetchMock(() => errorResponse(500));

    await bootstrapApp({ hash: "#dashboard", fetchMock });
    await flushMicrotasks(20);

    await waitFor(() => document.getElementById("dummyStatusUpdated") !== null);

    expect(document.getElementById("dummyStatusUpdated").textContent).toContain("HTTP 500");
  });
});