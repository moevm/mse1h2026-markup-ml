const {
  bootstrapApp,
  flushMicrotasks,
} = require("./testUtils");

describe("compare page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("рендерит таблицу сравнения для двух запусков одного датасета", async () => {
    await bootstrapApp({ hash: "#compare" });
    await flushMicrotasks(12);

    expect(document.body.textContent).toContain("Сравнение запусков");
    expect(document.body.textContent).toContain("Run #run-1");
    expect(document.body.textContent).toContain("Run #run-2");
    expect(document.body.textContent).toContain("Optimizer");
  });

  test("если оставить один запуск, показывает состояние с подсказкой", async () => {
    await bootstrapApp({ hash: "#compare" });
    await flushMicrotasks(12);

    const checkbox = document.querySelector("#compareRunList input[type='checkbox'][value='run-2']");
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    await flushMicrotasks(12);

    expect(document.body.textContent).toContain("Выберите минимум два запуска для сравнения");
  });
});