const { formToJSON } = require("../../static/app.js");

function makeForm(html) {
  document.body.innerHTML = html;
  return document.querySelector("form");
}

test("собирает text и textarea", () => {
  const form = makeForm(`
    <form>
      <input name="a" value="hello" />
      <textarea name="b">world</textarea>
    </form>
  `);

  expect(formToJSON(form)).toEqual({ a: "hello", b: "world" });
});

test("number превращает в число, пустое оставляет пустым", () => {
  const form1 = makeForm(`<form><input type="number" name="n" value="42" /></form>`);
  expect(formToJSON(form1)).toEqual({ n: 42 });

  const form2 = makeForm(`<form><input type="number" name="n" value="" /></form>`);
  expect(formToJSON(form2)).toEqual({ n: "" });
});

test("radio берёт только выбранный", () => {
  const form = makeForm(`
    <form>
      <input type="radio" name="r" value="x" />
      <input type="radio" name="r" value="y" checked />
    </form>
  `);

  expect(formToJSON(form)).toEqual({ r: "y" });
});

test("одиночный checkbox даёт boolean", () => {
  const form1 = makeForm(`<form><input type="checkbox" name="c" checked /></form>`);
  expect(formToJSON(form1)).toEqual({ c: true });

  const form2 = makeForm(`<form><input type="checkbox" name="c" /></form>`);
  expect(formToJSON(form2)).toEqual({ c: false });
});

test("группа checkbox с одним name даёт массив значений отмеченных", () => {
  const form = makeForm(`
    <form>
      <input type="checkbox" name="tags" value="a" checked />
      <input type="checkbox" name="tags" value="b" />
      <input type="checkbox" name="tags" value="c" checked />
    </form>
  `);

  expect(formToJSON(form)).toEqual({ tags: ["a", "c"] });
});

test("select multiple даёт массив", () => {
  const form = makeForm(`
    <form>
      <select name="s" multiple>
        <option value="1" selected>1</option>
        <option value="2">2</option>
        <option value="3" selected>3</option>
      </select>
    </form>
  `);

  expect(formToJSON(form)).toEqual({ s: ["1", "3"] });
});

test("повторяющиеся name собираются в массив", () => {
  const form = makeForm(`
    <form>
      <input name="x" value="a" />
      <input name="x" value="b" />
    </form>
  `);

  expect(formToJSON(form)).toEqual({ x: ["a", "b"] });
});

test("disabled и элементы без name игнорируются", () => {
  const form = makeForm(`
    <form>
      <input name="ok" value="1" />
      <input name="skip" value="2" disabled />
      <input value="no-name" />
    </form>
  `);

  expect(formToJSON(form)).toEqual({ ok: "1" });
});

test("file input: возвращает имена файлов", () => {
  const form = makeForm(`<form><input type="file" name="f" /></form>`);
  const input = form.querySelector('input[type="file"]');

  const file1 = new File(["a"], "a.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file1] });

  expect(formToJSON(form)).toEqual({ f: "a.txt" });
});