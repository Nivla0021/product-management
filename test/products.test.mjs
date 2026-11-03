import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../api/products.mjs";
import { validateProduct } from "../docs/product.js";

const id = "a6ae925c-7325-41b2-8a58-a55fd591fc04";
const env = {
  ADMIN_PASSWORD: "test-only-password",
  ALLOWED_ORIGINS: "https://example.github.io,http://localhost:4173",
  DATABASE_URL: "test-only",
};
const product = { id, name: "Coffee", price: "150.25" };
function request(method = "GET", body, path = "/products", headers = {}) {
  return new Request(`https://api.example${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.ADMIN_PASSWORD}`,
      Origin: "https://example.github.io",
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("money is normalized without floating-point rounding", () => {
  for (const [input, expected] of [
    ["0", "0.00"],
    ["0.1", "0.10"],
    ["00010.20", "10.20"],
    ["9999999999.99", "9999999999.99"],
  ]) {
    assert.deepEqual(validateProduct({ name: " Coffee ", price: input }), {
      product: { name: "Coffee", price: expected },
    });
  }
});

test("rejects blank/long names and invalid prices", () => {
  for (const name of ["", "  ", "a".repeat(161), null])
    assert.ok(validateProduct({ name, price: "1" }).error);
  for (const price of [
    "-1",
    "1.234",
    "1e2",
    "NaN",
    "Infinity",
    "1,000",
    "",
    "10000000000",
    1,
    null,
  ]) {
    assert.ok(
      validateProduct({ name: "Coffee", price }).error,
      `reject ${price}`,
    );
  }
  assert.ok(validateProduct(null).error);
});

test("authentication, origin restrictions, preflight, and missing config never access the DB", async () => {
  const handler = createHandler({
    env,
    query: () => assert.fail("must not query"),
  });
  assert.equal(
    (
      await handler(
        request("GET", undefined, "/products", { Authorization: "" }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handler(
        request("GET", undefined, "/products", {
          Authorization: "Bearer wrong",
        }),
      )
    ).status,
    401,
  );
  const forbidden = await handler(
    request("GET", undefined, "/products", { Origin: "https://other.example" }),
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("Access-Control-Allow-Origin"), null);
  const preflight = await handler(
    request("OPTIONS", undefined, "/products", { Authorization: "" }),
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("Access-Control-Allow-Origin"),
    "https://example.github.io",
  );
  assert.match(
    preflight.headers.get("Access-Control-Allow-Methods"),
    /PUT, DELETE/,
  );
  const missing = createHandler({
    env: {},
    query: () => assert.fail("must not query"),
  });
  assert.equal((await missing(request())).status, 503);
});

test("CRUD returns products and uses bound parameters for user input", async () => {
  const calls = [];
  const handler = createHandler({
    env,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [product] };
    },
  });
  const list = await handler(request());
  assert.deepEqual(await list.json(), { products: [product] });
  assert.equal(list.headers.get("Cache-Control"), "no-store");
  const name = "Coffee'); DROP TABLE products; --";
  const created = await handler(request("POST", { name, price: "150.25" }));
  assert.equal(created.status, 201);
  assert.deepEqual(calls[1].params, [name, "150.25"]);
  assert.ok(!calls[1].sql.includes(name));
  const updated = await handler(
    request("PUT", { name: "Tea", price: "0" }, `/products/${id}`),
  );
  assert.equal(updated.status, 200);
  assert.deepEqual(calls[2].params, ["Tea", "0.00", id]);
  const deleted = await handler(
    request("DELETE", undefined, `/products/${id}`),
  );
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.deepEqual(calls[3].params, [id]);
});

test("invalid requests never query the database", async () => {
  const handler = createHandler({
    env,
    query: () => assert.fail("must not query"),
  });
  for (const [req, status] of [
    [request("POST", { name: " ", price: "2" }), 400],
    [request("POST", { name: "Coffee", price: "2.222" }), 400],
    [request("DELETE", undefined, "/products/nope"), 400],
    [request("PATCH"), 405],
    [request("GET", undefined, "/unknown"), 404],
    [request("GET", undefined, `/products/${id}`), 405],
    [
      request("POST", { name: "Coffee", price: "2" }, "/products", {
        "Content-Type": "text/plain",
      }),
      400,
    ],
    [request("POST", { name: "a".repeat(9000), price: "2" }), 400],
  ])
    assert.equal((await handler(req)).status, status);
  const malformed = request("POST", undefined);
  const invalidJson = new Request(malformed, { body: "{" });
  assert.equal((await handler(invalidJson)).status, 400);
});

test("missing products and database failures give safe errors", async () => {
  const absent = createHandler({ env, query: async () => ({ rows: [] }) });
  assert.equal(
    (await absent(request("DELETE", undefined, `/products/${id}`))).status,
    404,
  );
  assert.equal(
    (
      await absent(
        request("PUT", { name: "Tea", price: "5" }, `/products/${id}`),
      )
    ).status,
    404,
  );
  const broken = createHandler({
    env,
    query: async () => {
      throw Object.assign(new Error("secret connection details"), {
        code: "TEST",
      });
    },
  });
  const response = await broken(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("secret connection details"));
});
