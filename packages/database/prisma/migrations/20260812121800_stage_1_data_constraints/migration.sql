ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_amount_nonnegative" CHECK ("price_amount" >= 0),
  ADD CONSTRAINT "products_stock_nonnegative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "products_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$');
