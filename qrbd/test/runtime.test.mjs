import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { configureRuntime, validEncryptionKey } from "../lib/runtime.mjs";

test("production requires HTTPS, a safe enrollment policy and no preview bypass", async () => {
  const data = await mkdtemp(tmpdir() + "/qrbd-runtime-");
  try {
    const base = {
      NODE_ENV: "production",
      QRBD_PUBLIC_URL: "https://qrbd.example",
      QRBD_REGISTRATION_CODE: "example-invitation-not-a-real-secret",
    };
    for (const override of [
      { QRBD_PUBLIC_URL: "" },
      { QRBD_PUBLIC_URL: "http://qrbd.example" },
      { QRBD_PUBLIC_URL: "https://qrbd.example/path" },
      { QRBD_EMBED_PREVIEW: "1" },
      { QRBD_REGISTRATION_CODE: "" },
      { QRBD_REGISTRATION_CODE: "short" },
      { QRBD_TRUST_PROXY_HOPS: "true" },
    ])
      assert.throws(() => configureRuntime({ ...base, ...override }, data));
    const env = { ...base, QRBD_TRUST_PROXY_HOPS: "1" };
    const result = configureRuntime(env, data);
    assert.equal(result.production, true);
    assert.equal(result.proxyHops, 1);
    assert.ok(validEncryptionKey(env.QRBD_SECRET_KEY));
    const saved = await readFile(data + "/.encryption-key", "utf8");
    assert.equal(env.QRBD_SECRET_KEY, saved);
    assert.equal((await stat(data + "/.encryption-key")).mode & 0o777, 0o600);
    const restarted = { ...base };
    configureRuntime(restarted, data);
    assert.equal(restarted.QRBD_SECRET_KEY, saved, "restart must reuse key");
    const render = {
      NODE_ENV: "production",
      RENDER_EXTERNAL_URL: "https://qrbd-service.onrender.com",
      QRBD_OPEN_REGISTRATION: "true",
    };
    configureRuntime(render, data);
    assert.equal(render.QRBD_PUBLIC_URL, render.RENDER_EXTERNAL_URL);
    assert.throws(() =>
      configureRuntime({ ...base, QRBD_SECRET_KEY: "bad" }, data),
    );
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
