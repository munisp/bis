CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_namespace_key_unique"
  ON "platform_settings" USING btree ("namespace", "key");
