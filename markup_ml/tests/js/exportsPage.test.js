const {
  bootstrapApp,
  flushMicrotasks,
} = require("./testUtils");

describe("exports page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  test("показывает ссылки на экспорт JSON и YAML для запусков", async () => {
    await bootstrapApp({ hash: "#exports" });
    await flushMicrotasks(10);

    const links = Array.from(document.querySelectorAll("a[href*='/api/exports/runs/']"));

    expect(links.length).toBeGreaterThan(0);

    const jsonLink = links.find((link) => link.href.includes("format=json"));
    const yamlLink = links.find((link) => link.href.includes("format=yaml"));

    expect(jsonLink).toBeTruthy();
    expect(yamlLink).toBeTruthy();

    expect(jsonLink.getAttribute("href")).toContain("/api/exports/runs/run-1?format=json");
    expect(yamlLink.getAttribute("href")).toContain("/api/exports/runs/run-1?format=yaml");
  });
});