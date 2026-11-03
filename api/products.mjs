import { createHash, timingSafeEqual } from "node:crypto";
import { validateProduct } from "../docs/product.js";

const table = "product_manager.products";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (value) => createHash("sha256").update(value).digest();

async function readJson(request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error("Send the product as JSON.");
  }
  let size = 0;
  const chunks = [];
  if (!request.body) throw new Error("Enter a product name and price.");
  for await (const chunk of request.body) {
    size += chunk.length;
    if (size > 8192) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Send a valid JSON product.");
  }
}

export function createHandler({ query, env }) {
  const origins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = { "Cache-Control": "no-store", Vary: "Origin" };
    if (origin && origins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
      headers["Access-Control-Allow-Methods"] =
        "GET, POST, PUT, DELETE, OPTIONS";
    }
    const json = (body, status = 200) =>
      Response.json(body, { status, headers });
    if (!env.ADMIN_PASSWORD || !env.ALLOWED_ORIGINS || !env.DATABASE_URL) {
      return json(
        {
          error:
            "API setup is incomplete. Configure the database, admin password, and allowed origins.",
        },
        503,
      );
    }
    if (origin && !origins.includes(origin))
      return json({ error: "This website origin is not allowed." }, 403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const provided = request.headers.get("authorization") || "";
    if (
      !timingSafeEqual(digest(provided), digest(`Bearer ${env.ADMIN_PASSWORD}`))
    ) {
      return json(
        { error: "Incorrect admin password. Please unlock the app again." },
        401,
      );
    }
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    const match = /^\/products(?:\/([^/]+))?$/.exec(path);
    if (!match) return json({ error: "Endpoint not found." }, 404);
    const id = match[1];
    if (id && !uuid.test(id))
      return json({ error: "Invalid product ID." }, 400);
    const method = request.method;
    if (
      (!id && !["GET", "POST"].includes(method)) ||
      (id && !["PUT", "DELETE"].includes(method))
    ) {
      return json({ error: "Method not allowed." }, 405);
    }
    let product;
    if (method === "POST" || method === "PUT") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return json({ error: error.message }, 400);
      }
      const result = validateProduct(body);
      if (result.error) return json({ error: result.error }, 400);
      product = result.product;
    }
    try {
      if (method === "GET") {
        const { rows } = await query(
          `SELECT id, name, price FROM ${table} ORDER BY name, id`,
        );
        return json({ products: rows });
      }
      let result;
      if (method === "POST") {
        result = await query(
          `INSERT INTO ${table} (name, price) VALUES ($1, $2) RETURNING id, name, price`,
          [product.name, product.price],
        );
      } else if (method === "PUT") {
        result = await query(
          `UPDATE ${table} SET name = $1, price = $2 WHERE id = $3 RETURNING id, name, price`,
          [product.name, product.price, id],
        );
      } else {
        result = await query(
          `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
          [id],
        );
      }
      if (!result.rows.length)
        return json(
          { error: "Product no longer exists. Reload the list." },
          404,
        );
      if (method === "DELETE")
        return new Response(null, { status: 204, headers });
      return json({ product: result.rows[0] }, method === "POST" ? 201 : 200);
    } catch (error) {
      console.error(
        "Product database operation failed:",
        error.code || "unknown",
      );
      return json(
        {
          error:
            "Could not access the database. Check API configuration and SQL setup, then try again.",
        },
        503,
      );
    }
  };
}
