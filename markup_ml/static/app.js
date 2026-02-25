const BASE_URL = '';
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

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("params-form") || document.querySelector("form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const payload = formToJSON(form);
    console.log(payload);
    console.log(JSON.stringify(payload, null, 2));
  });
});

if (typeof module === "object" && module.exports) {
  module.exports = { formToJSON };
}

if (typeof window !== "undefined") {
  window.formToJSON = formToJSON;
}
