BEGIN;
CREATE SCHEMA IF NOT EXISTS product_manager;
CREATE TABLE IF NOT EXISTS product_manager.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  price numeric(12,2) NOT NULL CHECK (price >= 0)
);
COMMIT;
