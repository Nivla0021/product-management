import pg from "pg";
import { attachDatabasePool } from "@neon/functions";
import { createHandler } from "./products.mjs";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
});
attachDatabasePool(pool);

export default {
  fetch: createHandler({
    query: (sql, params) => pool.query(sql, params),
    env: process.env,
  }),
};
