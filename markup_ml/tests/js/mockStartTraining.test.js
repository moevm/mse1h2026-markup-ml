const {
  bootstrapApp,
  flushMicrotasks,
  waitFor,
} = require("./testUtils");

describe("dataset launch flow", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("launch submits to real run endpoint and opens run logs page", async () => {
    const { fetchMock } = await bootstrapApp({ hash: "#datasets" });
    await flushMicrotasks(12);

    const form = document.getElementById("launchRunForm");
    expect(form).not.toBeNull();

    const button = form.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(false);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(button.disabled).toBe(true);

    await waitFor(() => window.location.hash === "#runs/run-4");
    window.dispatchEvent(new Event("hashchange"));
    await flushMicrotasks(12);

    expect(document.getElementById("page-title").textContent).toBe("Run #run-4");
    expect(document.getElementById("runLogsTextarea")).not.toBeNull();

    const postCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).includes("/api/datasets/ds-1/runs") &&
        String(options?.method || "").toUpperCase() === "POST"
    );

    expect(postCall).toBeTruthy();
  });
});
