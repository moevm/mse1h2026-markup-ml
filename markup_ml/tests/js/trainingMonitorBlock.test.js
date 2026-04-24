const {
  bootstrapApp,
  flushMicrotasks,
  waitFor,
} = require("./testUtils");

describe("training monitor block", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("block is hidden by default on datasets page", async () => {
    await bootstrapApp({ hash: "#datasets" });
    await flushMicrotasks(20);

    const block = document.getElementById("datasetTrainingMonitor");
    const textarea = document.getElementById("datasetTrainingLogsTextarea");

    expect(block).not.toBeNull();
    expect(block.hidden).toBe(true);
    expect(textarea).not.toBeNull();
    expect(textarea.readOnly).toBe(true);
    expect(textarea.style.height).toBe("220px");
  });

  test("after submit the block becomes visible before redirect", async () => {
    await bootstrapApp({ hash: "#datasets" });
    await flushMicrotasks(20);

    const form = document.getElementById("launchRunForm");
    const button = form.querySelector('button[type="submit"]');
    const block = document.getElementById("datasetTrainingMonitor");
    const status = document.getElementById("datasetTrainingLogsStatus");
    const textarea = document.getElementById("datasetTrainingLogsTextarea");

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(button.disabled).toBe(true);
    expect(block.hidden).toBe(false);
    expect(textarea.readOnly).toBe(true);
    expect(status.textContent.length).toBeGreaterThan(0);

    await flushMicrotasks(20);
    await waitFor(() => window.location.hash === "#runs/run-4");
  });
});
