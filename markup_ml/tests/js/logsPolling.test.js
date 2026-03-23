const {
  fetchLogs,
  renderLogsWithAutoscroll,
  startLogsPolling,
} = require("../../static/app.js");

const flushPromises = async (n = 5) => {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
};

describe("мониторинг логов", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    document.body.innerHTML = "";
  });

  test("автоскролл при обновлении текста", () => {
    const ta = document.createElement("textarea");
    Object.defineProperty(ta, "scrollHeight", { value: 999, configurable: true });

    renderLogsWithAutoscroll(ta, "hello\nworld");

    expect(ta.value).toBe("hello\nworld");
    expect(ta.scrollTop).toBe(999);
  });

  test("загрузка логов возвращает текст", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "LOGS",
    }));

    const text = await fetchLogs("mocks/dummy_logs.txt");

    expect(text).toBe("LOGS");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("периодическое обновление логов меняет содержимое textarea", async () => {
    document.body.innerHTML = `
      <textarea id="logs-textarea"></textarea>
      <div id="logs-status"></div>
    `;

    let call = 0;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => (call++ === 0 ? "A" : "B"),
    }));

    const stop = startLogsPolling({
      textareaId: "logs-textarea",
      statusId: "logs-status",
      url: "mocks/dummy_logs.txt",
      intervalMs: 1000,
    });

    await flushPromises();
    expect(document.getElementById("logs-textarea").value).toBe("A");

    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(document.getElementById("logs-textarea").value).toBe("B");

    stop();
  });
});