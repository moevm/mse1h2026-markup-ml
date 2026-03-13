const {
  bootstrapApp,
  flushMicrotasks,
  waitFor,
} = require("./testUtils");

describe("settings page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("сохраняет настройки датасета через PUT", async () => {
    const { fetchMock } = await bootstrapApp({ hash: "#settings" });
    await flushMicrotasks(12);

    const form = document.getElementById("settingsForm");
    expect(form).not.toBeNull();

    form.querySelector("#settingsName").value = "Retail Detection Updated";
    form.querySelector("#settingsDescription").value = "Updated description";
    form.querySelector("#settingsBudget").value = "32";
    form.querySelector("#settingsDevice").value = "gpu1";
    form.querySelector("#settingsPriority").value = "high";

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }

    await waitFor(() =>
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).includes("/api/datasets/") &&
          String(url).includes("/settings") &&
          String(options?.method || "").toUpperCase() === "PUT"
      )
    );

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).includes("/api/datasets/") &&
        String(url).includes("/settings") &&
        String(options?.method || "").toUpperCase() === "PUT"
    );

    expect(putCall).toBeTruthy();

    const [, options] = putCall;
    const payload = JSON.parse(options.body);

    expect(payload.name).toBe("Retail Detection Updated");
    expect(payload.description).toBe("Updated description");
    expect(payload.budget).toBe(32);
    expect(payload.device).toBe("gpu1");
    expect(payload.priority).toBe("high");
  });
});