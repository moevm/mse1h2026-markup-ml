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

function errorResponse(status, detail) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ detail }),
    text: async () => JSON.stringify({ detail }),
  });
}

function createErrorFetchMock() {
  return jest.fn((request, options = {}) => {
    const key = String(request);
    const method = String(options.method || "GET").toUpperCase();

    if (key.includes("/api/dashboard")) {
      return jsonResponse({
        summary: {
          datasetsCount: 0,
          runsCount: 0,
          runningCount: 0,
          queuedCount: 0,
        },
        topDatasets: [],
      });
    }

    if (key.includes("/api/dataset-sources") && method === "GET") {
      return jsonResponse([
        {
          id: "missing",
          name: "Missing dataset",
          relativePath: "missing",
          sourceType: "directory",
        },
      ]);
    }

    if (key.includes("/api/datasets") && method === "GET") {
      return jsonResponse([]);
    }

    if (key.includes("/api/runs") && method === "GET") {
      return jsonResponse([]);
    }

    if (key.includes("/api/datasets") && method === "POST") {
      return errorResponse(400, "Dataset source was not found: /app/datasets/missing");
    }

    return Promise.reject(new Error(`Unexpected fetch: ${method} ${key}`));
  });
}

describe("dataset upload errors", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("frontend shows backend 400 detail instead of failing silently", async () => {
    const fetchMock = createErrorFetchMock();

    await bootstrapApp({ hash: "#datasets", fetchMock });
    await flushMicrotasks(20);

    const form = document.getElementById("datasetUploadForm");
    form.querySelector("#displayName").value = "Broken dataset";
    form.querySelector("#datasetSource").value = "missing";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flushMicrotasks(20);
    await waitFor(() => document.querySelector("#app-notice .notice.error") !== null);

    expect(document.querySelector("#app-notice").textContent).toContain("Dataset source was not found");
  });
});
