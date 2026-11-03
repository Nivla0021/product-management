import { validateProduct } from "./product.js";

const $ = (id) => document.getElementById(id);
let password = "";
let products = [];
let editingId = null;
let busy = false;
let apiUrl;
try {
  const url = new URL(window.APP_CONFIG?.apiUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error();
  if (url.username || url.password || url.search || url.hash) throw new Error();
  apiUrl = url.href.replace(/\/$/, "");
} catch {
  $("setup").hidden = false;
  $("unlock-button").disabled = true;
  $("password").disabled = true;
}

function message(text, kind = "") {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
  $("message").setAttribute("role", kind === "error" ? "alert" : "status");
}

function updateControls() {
  $("product-fields").disabled = !password || busy;
  $("refresh").disabled = !password || busy;
  $("search").disabled = !password;
  $("unlock-button").disabled = !apiUrl || busy;
  $("password").disabled = !apiUrl || busy;
  $("lock").disabled = busy;
  document.querySelectorAll(".text-button").forEach((button) => {
    button.disabled = busy;
  });
  $("unlock-panel").hidden = Boolean(password);
  $("lock").hidden = !password;
  $("product-form").setAttribute("aria-busy", String(busy));
}

async function api(path, options = {}, credential = password) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Could not reach the API. Check your connection, API URL, and allowed origins, then try again.",
    );
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) lock();
    throw new Error(
      data?.error ||
        `The API returned an error (${response.status}). Please try again.`,
    );
  }
  if (response.status !== 204 && !data)
    throw new Error(
      "The API returned an invalid response. Check its URL and try again.",
    );
  return data;
}

function resetEditor() {
  editingId = null;
  $("product-form").reset();
  $("form-title").textContent = "Add a product";
  $("save").textContent = "＋ Add product";
  $("cancel").hidden = true;
}

function lock() {
  password = "";
  products = [];
  $("password").value = "";
  $("search").value = "";
  // Keep unsaved product details available when a password must be re-entered.
  render();
  updateControls();
}

function render() {
  const search = $("search").value.trim().toLowerCase();
  const visible = products.filter((product) =>
    product.name.toLowerCase().includes(search),
  );
  $("products").replaceChildren();
  $("count").textContent = search
    ? `${visible.length} of ${products.length}`
    : products.length;
  $("empty").hidden = visible.length > 0;
  $("table-wrap").hidden = visible.length === 0;
  const noMatches = Boolean(search && products.length);
  $("empty-title").textContent = noMatches
    ? "No matching products"
    : "Your next product starts here";
  $("empty-description").textContent = password
    ? noMatches
      ? "Try a different product name or clear the search."
      : "Add your first product using the form."
    : "Unlock your workspace to see your products.";
  for (const product of visible.sort((a, b) => a.name.localeCompare(b.name))) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = product.name;
    const price = document.createElement("td");
    price.textContent = new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(product.price);
    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const [label, action] of [
      ["Edit", () => edit(product)],
      ["Delete", () => remove(product)],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `text-button${label === "Delete" ? " danger" : ""}`;
      button.textContent = label;
      button.setAttribute("aria-label", `${label} ${product.name}`);
      button.disabled = busy;
      button.addEventListener("click", action);
      actions.append(button);
    }
    actionsCell.append(actions);
    row.append(name, price, actionsCell);
    $("products").append(row);
  }
}

async function run(action) {
  if (busy) return;
  busy = true;
  updateControls();
  try {
    await action();
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    updateControls();
  }
}

function edit(product) {
  editingId = product.id;
  $("name").value = product.name;
  $("price").value = product.price;
  $("form-title").textContent = "Edit product";
  $("save").textContent = "Save changes";
  $("cancel").hidden = false;
  message("Editing product. Update its details below.");
  $("name").focus();
}

async function remove(product) {
  if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`))
    return;
  await run(async () => {
    message("Deleting product…");
    await api(`/products/${product.id}`, { method: "DELETE" });
    products = products.filter((item) => item.id !== product.id);
    if (editingId === product.id) resetEditor();
    render();
    message("Product deleted.", "success");
  });
}

$("unlock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const entered = $("password").value;
  if (!apiUrl || !entered) return;
  run(async () => {
    message("Opening your workspace…");
    const data = await api("/products", {}, entered);
    password = entered;
    $("password").value = "";
    products = data.products;
    render();
    message("Workspace unlocked.", "success");
  });
});

$("product-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateProduct({
    name: $("name").value,
    price: $("price").value,
  });
  if (result.error) return message(result.error, "error");
  run(async () => {
    const wasEditing = Boolean(editingId);
    message(wasEditing ? "Saving changes…" : "Adding product…");
    const data = await api(editingId ? `/products/${editingId}` : "/products", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(result.product),
    });
    products = products.filter((product) => product.id !== data.product.id);
    products.push(data.product);
    resetEditor();
    render();
    message(wasEditing ? "Product updated." : "Product added.", "success");
  });
});

$("refresh").addEventListener("click", () =>
  run(async () => {
    message("Loading products…");
    const data = await api("/products");
    products = data.products;
    render();
    message("Product list is up to date.", "success");
  }),
);
$("search").addEventListener("input", render);
$("cancel").addEventListener("click", () => {
  resetEditor();
  message("Editing canceled.");
});
$("lock").addEventListener("click", () => {
  resetEditor();
  lock();
  message("Workspace locked.");
  $("password").focus();
});
updateControls();
