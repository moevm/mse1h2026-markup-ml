const BASE_URL = '';
const LOGS_URL = (BASE_URL ? `${BASE_URL}/` : "") + "mocks/dummy_logs.txt";
const LOGS_POLL_INTERVAL_MS = 1500;

/**
 * Преобразует HTML-форму в обычный JS-объект
 *
 * Правила:
 * - Учитываются только enabled элементы INPUT/SELECT/TEXTAREA с атрибутом name
 * - radio: попадает только выбранное значение
 * - checkbox: одиночный -> boolean; группа с одинаковым name -> массив значений отмеченных
 * - select[multiple]: массив выбранных значений
 * - number/range: число (если поле пустое, остается "")
 * - file: имена файлов (для отладки)
 * - повторяющиеся name накапливаются в массив
 *
 * @param {HTMLFormElement} form
 * @returns {Record<string, any>}
 */
function formToJSON(form) {
  const data = {};
  const processedCheckboxGroups = new Set();

  const elements = Array.from(form.elements).filter((el) => {
    return el.name && !el.disabled && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
  });

  for (const el of elements) {
    const name = el.name;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || "").toLowerCase();

    if (type === "radio") {
      if (!el.checked) continue;
      setValue(data, name, el.value);
      continue;
    }

    if (type === "checkbox") {
      const selectorName = escapeForSelector(name);
      const group = form.querySelectorAll(`input[type="checkbox"][name="${selectorName}"]`);

      // если это группа (одинаковый name встречается несколько раз)
      if (group.length > 1) {
        // уже собирали этот name — пропускаем
        if (processedCheckboxGroups.has(name)) continue;
        processedCheckboxGroups.add(name);

        const checkedValues = Array.from(group)
          .filter((c) => c.checked)
          .map((c) => c.value);

        // для группы кладём массив ровно один раз
        data[name] = checkedValues;
      } else {
        setValue(data, name, !!el.checked);
      }
      continue;
    }

    if (tag === "select" && el.multiple) {
      const values = Array.from(el.selectedOptions).map((opt) => opt.value);
      setValue(data, name, values);
      continue;
    }

    if (type === "file") {
      const files = el.files ? Array.from(el.files).map((f) => f.name) : [];
      setValue(data, name, el.multiple ? files : (files[0] ?? ""));
      continue;
    }

    if (type === "number" || type === "range") {
      const v = el.value;
      setValue(data, name, v === "" ? "" : Number(v));
      continue;
    }

    setValue(data, name, el.value);
  }

  return data;
}

/**
 * Записывает значение по ключу с поддержкой повторяющихся name (накопление в массив)
 * @param {Record<string, any>} obj
 * @param {string} key
 * @param {any} value
 */
function setValue(obj, key, value) {
  if (obj[key] === undefined) {
    obj[key] = value;
    return;
  }

  if (Array.isArray(obj[key])) {
    obj[key] = Array.isArray(value) ? obj[key].concat(value) : obj[key].concat([value]);
    return;
  }

  obj[key] = Array.isArray(value) ? [obj[key], ...value] : [obj[key], value];
}

/**
 * Экранирование строки для использования в CSS attribute selector
 * @param {string} name
 * @returns {string}
 */
function escapeForSelector(name) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(name);
  return String(name).replace(/"/g, '\\"');
}

/**
 * Загружает текст логов (с cache-busting)
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchLogs(url) {
  const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * Обновляет textarea и автоскроллит вниз
 * @param {HTMLTextAreaElement} textarea
 * @param {string} text
 */
function renderLogsWithAutoscroll(textarea, text) {
  textarea.value = text;
  // автоскролл вниз
  textarea.scrollTop = textarea.scrollHeight;
}

/**
 * Запускает периодическое обновление логов
 * @param {{ textareaId: string, statusId?: string, url?: string, intervalMs?: number }} opts
 * @returns {() => void} stop()
 */
function startLogsPolling(opts) {
  const {
    textareaId,
    statusId,
    url = LOGS_URL,
    intervalMs = LOGS_POLL_INTERVAL_MS,
  } = opts;

  const textarea = document.getElementById(textareaId);
  const statusEl = statusId ? document.getElementById(statusId) : null;

  if (!textarea) {
    console.warn(`Logs textarea #${textareaId} not found`);
    return () => {};
  }

  let lastText = null;
  let timerId = null;

  const tick = async () => {
    try {
      if (statusEl) statusEl.textContent = "Обновление логов...";
      const text = await fetchLogs(url);


      if (text !== lastText) {
        renderLogsWithAutoscroll(textarea, text);
        lastText = text;
      }

      if (statusEl) statusEl.textContent = `Обновлено: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      console.error("Failed to load logs:", e);
      if (statusEl) statusEl.textContent = `Ошибка загрузки логов: ${e.message}`;
    }
  };

  tick();
  timerId = setInterval(tick, intervalMs);

  return () => {
    if (timerId) clearInterval(timerId);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  // мониторинг логов
  startLogsPolling({
    textareaId: "logs-textarea",
    statusId: "logs-status",
    url: LOGS_URL,
    intervalMs: LOGS_POLL_INTERVAL_MS,
  });

  const form = document.getElementById("trainingForm") || document.querySelector("form");
  if (!form) return;

  const statusEl = document.getElementById("train-status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitBtn =
      event.submitter ||
      form.querySelector('button[type="submit"], input[type="submit"]');

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Статус: отправка...";

    const payload = formToJSON(form);

    const res = await mockStartTraining(payload);
    if (statusEl) statusEl.textContent = `Статус: ${res.status}`;
  });
});

if (typeof module === "object" && module.exports) {
  module.exports = {
    formToJSON,
    mockStartTraining,
    fetchLogs,
    renderLogsWithAutoscroll,
    startLogsPolling,
  };
}

if (typeof window !== "undefined") {
  window.formToJSON = formToJSON;
  window.mockStartTraining = mockStartTraining;
}

/**
 * Имитирует отправку данных на сервер с задержкой 1 сек.
 * @param {Record<string, any>} data
 * @returns {Promise<{status: "started"}>}
 */
function mockStartTraining(data) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: "started" }), 1000);
  });
}
