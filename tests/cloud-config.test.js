import test from "node:test";
import assert from "node:assert/strict";
import {
  readCloudConfig,
  validateCloudConfig,
  CLOUD_CONFIG_KEY,
} from "../src/cloud-config.js";
const publicConfig = {
  url: "https://example-project.supabase.co",
  key: "sb_publishable_test_public_key_12345678901234567890",
};
test("public project configuration is accepted and local override takes precedence", () => {
  assert.deepEqual(validateCloudConfig(publicConfig), publicConfig);
  assert.deepEqual(
    readCloudConfig(
      { getItem: () => JSON.stringify(publicConfig) },
      {
        VITE_SUPABASE_URL: "https://build.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: publicConfig.key,
      },
    ),
    publicConfig,
  );
  assert.equal(readCloudConfig({ getItem: () => null }), null);
});
test("secret keys and unsafe project addresses are refused", () => {
  for (const key of [
    "sb_secret_do_not_embed",
    "invalid",
    `a.${btoa(JSON.stringify({ role: "service_role" }))}.c`,
  ])
    assert.throws(
      () => validateCloudConfig({ ...publicConfig, key }),
      /publishable/,
    );
  for (const url of [
    "http://example-project.supabase.co",
    "https://example-project.supabase.co.evil.test",
    "https://user:password@example.supabase.co",
    "https://example.supabase.co/path",
  ])
    assert.throws(() => validateCloudConfig({ ...publicConfig, url }));
});
