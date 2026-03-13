const {
  bootstrapApp,
  flushMicrotasks,
  waitFor,
} = require("./testUtils");

describe("runs routing", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("клик по строке в runs открывает детальную страницу запуска", async () => {
    await bootstrapApp({ hash: "#runs" });
    await flushMicrotasks(10);

    const firstRow = document.querySelector("#runsTable tbody tr[data-run-id='run-1']");
    expect(firstRow).not.toBeNull();

    firstRow.click();

    await waitFor(() => window.location.hash === "#runs/run-1");
    window.dispatchEvent(new Event("hashchange"));
    await flushMicrotasks(10);

    expect(document.getElementById("page-title").textContent).toBe("Run #run-1");
    expect(document.body.textContent).toContain("Сводка запуска");

    const modelsTab = document.querySelector('.tab-btn[data-tab="models"]');
    expect(modelsTab).not.toBeNull();

    modelsTab.click();
    await flushMicrotasks(10);

    expect(document.body.textContent).toContain("Модели и параметры");
  });

  test("фильтр по датасету скрывает лишние строки", async () => {
    await bootstrapApp({ hash: "#runs" });
    await flushMicrotasks(10);

    const datasetFilter = document.getElementById("runsDatasetFilter");
    datasetFilter.value = "ds-2";
    datasetFilter.dispatchEvent(new Event("change", { bubbles: true }));

    const visibleRows = Array.from(document.querySelectorAll("#runsTable tbody tr"))
      .filter((row) => row.style.display !== "none");

    expect(visibleRows).toHaveLength(1);
    expect(visibleRows[0].dataset.runId).toBe("run-3");
  });
});