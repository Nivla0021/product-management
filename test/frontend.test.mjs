import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateProduct } from "../docs/product.js";

// A small DOM test double exercises app events without a browser or live Neon.
class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.handlers = {};
    this.hidden = false;
  }
  addEventListener(name, callback) {
    this.handlers[name] = callback;
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  append(...elements) {
    this.children.push(...elements);
  }
  replaceChildren(...elements) {
    this.children = elements;
  }
  focus() {}
  trigger(name) {
    return this.handlers[name]?.({ preventDefault() {} });
  }
}
const source = (
  await readFile(new URL("../docs/app.js", import.meta.url), "utf8")
).replace(/^import .*;\r?\n/, "");
const sample = {
  id: "a6ae925c-7325-41b2-8a58-a55fd591fc04",
  name: "<script>Coffee</script>",
  price: "150.25",
};

function setup(apiUrl = "https://api.example") {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  get("product-form").reset = () => {
    get("name").value = "";
    get("price").value = "";
  };
  const calls = [];
  let reply = () => Response.json({ products: [] });
  let confirmDelete = false;
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: () =>
      get("products").children.flatMap(
        (row) => row.children[2].children[0].children,
      ),
  };
  const window = { APP_CONFIG: { apiUrl }, confirm: () => confirmDelete };
  vm.runInNewContext(source, {
    document,
    window,
    validateProduct,
    URL,
    Intl,
    AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return reply(url, options);
    },
  });
  return {
    get,
    calls,
    window,
    respond: (callback) => {
      reply = callback;
    },
    allowDelete: () => {
      confirmDelete = true;
    },
    settle: () => new Promise((resolve) => setImmediate(resolve)),
    action: (index) =>
      get("products").children[0].children[2].children[0].children[index],
  };
}

test("missing or insecure API URL explains setup and disables unlocking", () => {
  for (const url of [
    "",
    "http://remote.example",
    "https://user:secret@example.com",
  ]) {
    const app = setup(url);
    assert.equal(app.get("setup").hidden, false);
    assert.equal(app.get("unlock-button").disabled, true);
    assert.equal(app.get("product-fields").disabled, true);
  }
});

test("unlock renders names as text, failed saves retain input, and canceling delete makes no request", async () => {
  const app = setup();
  app.respond(() => Response.json({ products: [sample] }));
  app.get("password").value = "test-only";
  app.get("unlock-form").trigger("submit");
  await app.settle();
  assert.equal(app.get("password").value, "");
  assert.equal(app.get("unlock-panel").hidden, true);
  assert.equal(app.get("product-fields").disabled, false);
  assert.equal(
    app.get("products").children[0].children[0].textContent,
    sample.name,
  );
  app.action(0).trigger("click");
  assert.equal(app.get("name").value, sample.name);
  app.get("name").value = "Changed coffee";
  app.respond(() =>
    Response.json({ error: "Database offline" }, { status: 503 }),
  );
  app.get("product-form").trigger("submit");
  await app.settle();
  assert.equal(app.get("name").value, "Changed coffee");
  assert.equal(app.get("price").value, "150.25");
  assert.match(app.get("message").textContent, /Database offline/);
  const before = app.calls.length;
  await app.action(1).trigger("click");
  assert.equal(app.calls.length, before);
  assert.equal(app.get("products").children.length, 1);
});

test("successful add, edit, delete and lock update the list without persisting the password", async () => {
  const app = setup();
  app.get("password").value = "test-only";
  app.get("unlock-form").trigger("submit");
  await app.settle();
  app.get("name").value = "Coffee";
  app.get("price").value = "150.2";
  app.respond(() =>
    Response.json(
      { product: { ...sample, name: "Coffee", price: "150.20" } },
      { status: 201 },
    ),
  );
  app.get("product-form").trigger("submit");
  await app.settle();
  assert.equal(app.get("products").children.length, 1);
  assert.equal(app.get("name").value, "");
  assert.equal(app.calls.at(-1).options.method, "POST");
  assert.equal(JSON.parse(app.calls.at(-1).options.body).price, "150.20");
  app.action(0).trigger("click");
  app.get("name").value = "Tea";
  app.respond(() => Response.json({ product: { ...sample, name: "Tea" } }));
  app.get("product-form").trigger("submit");
  await app.settle();
  assert.equal(app.calls.at(-1).options.method, "PUT");
  assert.equal(app.get("products").children[0].children[0].textContent, "Tea");
  app.allowDelete();
  app.respond(() => new Response(null, { status: 204 }));
  await app.action(1).trigger("click");
  assert.equal(app.calls.at(-1).options.method, "DELETE");
  assert.equal(app.get("products").children.length, 0);
  app.get("lock").trigger("click");
  assert.equal(app.get("product-fields").disabled, true);
  assert.equal(app.get("unlock-panel").hidden, false);
  assert.equal(app.window.localStorage, undefined);
  assert.equal(setup().get("product-fields").disabled, true);
});

test("wrong passwords and network failures display errors and keep the workspace locked", async () => {
  const app = setup();
  app.respond(() =>
    Response.json({ error: "Incorrect admin password" }, { status: 401 }),
  );
  app.get("password").value = "wrong";
  app.get("unlock-form").trigger("submit");
  await app.settle();
  assert.match(app.get("message").textContent, /Incorrect admin password/);
  assert.equal(app.get("product-fields").disabled, true);
  app.respond(() => {
    throw new Error("offline");
  });
  app.get("password").value = "test-only";
  app.get("unlock-form").trigger("submit");
  await app.settle();
  assert.match(app.get("message").textContent, /Could not reach the API/);
  assert.equal(app.get("unlock-button").disabled, false);
});
