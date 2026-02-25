const pathToApp = "../../static/app";

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve());
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

describe("submit handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="train-status"></div>
      <form id="params-form">
        <input name="a" value="1" />
        <input type="checkbox" name="tags" value="x" checked />
        <input type="checkbox" name="tags" value="y" />
        <button type="submit">Запуск</button>
      </form>
    `;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("кнопка блокируется сразу после submit и статус обновляется после ответа", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    require(pathToApp);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    const form = document.getElementById("params-form");
    const btn = form.querySelector('button[type="submit"]');
    const statusEl = document.getElementById("train-status");

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    expect(btn.disabled).toBe(true);
    expect(statusEl.textContent).toBe("Статус: отправка...");

    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    expect(statusEl.textContent).toBe("Статус: started");
    expect(btn.disabled).toBe(true);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});