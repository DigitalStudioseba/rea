import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { PDFDocument } from "pdf-lib";

test("real HTTP workflow: tenant isolation, pricing, upload, lifecycle and deletion", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qrbd-test-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", QRBD_DATA_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (b) => (logs += b));
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on("data", (b) => {
      const match = b.toString().match(/0.0.0.0:(\d+)/);
      if (match) resolve(match[1]);
    });
    child.on("exit", () => reject(new Error(logs)));
    setTimeout(
      () => reject(new Error("Startup timeout: " + logs)),
      10000,
    ).unref();
  });
  const base = "http://127.0.0.1:" + port;
  async function req(url, { cookie, body, method = "GET", headers = {} } = {}) {
    const r = await fetch(base + url, {
      method,
      headers: {
        "x-qrbd-request": "1",
        ...(cookie ? { cookie } : {}),
        ...(body && !(body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...headers,
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    let value;
    try {
      value = await r.json();
    } catch {}
    return { r, value, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  }
  const user = {
    name: "ঢাকা প্রিন্ট",
    email: "owner@example.com",
    password: "safe-test-password",
    bw: 3,
    color: 10,
  };
  const a = await req("/api/register", { method: "POST", body: user });
  assert.equal(a.r.status, 201);
  assert.ok(a.cookie);
  const owner = a.cookie,
    shop = a.value.id;
  assert.equal((await req("/api/me", { cookie: owner })).value.name, user.name);
  assert.equal(
    (await req("/api/register", { method: "POST", body: user })).r.status,
    409,
  );
  assert.equal(
    (
      await req("/api/login", {
        method: "POST",
        body: { email: user.email, password: "incorrect" },
      })
    ).r.status,
    401,
  );
  const login = await req("/api/login", {
    method: "POST",
    body: { email: user.email, password: user.password },
  });
  assert.equal(login.r.status, 200);
  const b = await req("/api/register", {
    method: "POST",
    body: { ...user, email: "other@example.com" },
  });
  const other = b.cookie;
  assert.equal((await req("/api/jobs")).r.status, 401);
  const csrf = await fetch(base + "/api/settings", {
    method: "PATCH",
    headers: { cookie: owner, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(csrf.status, 403);
  assert.equal(
    (
      await req("/api/settings", {
        method: "PATCH",
        cookie: owner,
        body: { bw: 3, color: 10, isOpen: true },
        headers: { origin: "https://evil.example" },
      })
    ).r.status,
    403,
  );
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  const bytes = await pdf.save();
  function form(content = bytes) {
    const f = new FormData();
    f.append(
      "files",
      new Blob([content], { type: "application/pdf" }),
      "notes.pdf",
    );
    f.append("color", "bw");
    f.append("copies", "3");
    f.append("consent", "yes");
    return f;
  }
  assert.equal(
    (
      await req("/api/shops/" + shop + "/jobs", {
        method: "POST",
        body: form("not a PDF"),
      })
    ).r.status,
    400,
  );
  const upload = await req("/api/shops/" + shop + "/jobs", {
    method: "POST",
    body: form(),
  });
  assert.equal(upload.r.status, 201);
  assert.equal(upload.value.amount, 18);
  assert.equal(upload.value.pages, 2);
  const job = upload.value.id;
  assert.equal((await req("/api/receipt/" + job)).value.amount, 18);
  assert.equal((await req("/api/jobs", { cookie: other })).value.length, 0);
  assert.equal(
    (
      await req("/api/jobs/" + job, {
        method: "PATCH",
        cookie: other,
        body: { status: "queued" },
      })
    ).r.status,
    404,
  );
  assert.equal(
    (await req("/api/jobs/" + job + "/document", { cookie: other })).r.status,
    404,
  );
  assert.equal(
    (await req("/api/jobs/" + job + "/document", { cookie: owner })).r.status,
    409,
  );
  assert.equal(
    (
      await req("/api/jobs/" + job, {
        method: "PATCH",
        cookie: owner,
        body: { status: "completed" },
      })
    ).r.status,
    409,
  );
  assert.equal(
    (
      await req("/api/settings", {
        method: "PATCH",
        cookie: owner,
        body: { bw: 5, color: 15, isOpen: true, message: "Test" },
      })
    ).r.status,
    200,
  );
  assert.equal(
    (await req("/api/receipt/" + job)).value.amount,
    18,
    "existing order price must be immutable",
  );
  for (const status of ["queued", "printing"])
    assert.equal(
      (
        await req("/api/jobs/" + job, {
          method: "PATCH",
          cookie: owner,
          body: { status },
        })
      ).r.status,
      200,
    );
  const doc = await fetch(base + "/api/jobs/" + job + "/document", {
    headers: { cookie: owner },
  });
  assert.equal(doc.status, 200);
  assert.equal((await doc.text()).slice(0, 5), "%PDF-");
  assert.equal(
    (
      await req("/api/jobs/" + job, {
        method: "PATCH",
        cookie: owner,
        body: { status: "completed" },
      })
    ).r.status,
    200,
  );
  assert.equal((await req("/api/receipt/" + job)).value.deleted, true);
  assert.equal((await readdir(path.join(dir, "files"))).length, 0);
  assert.equal(
    (await req("/api/jobs/" + job + "/document", { cookie: owner })).r.status,
    409,
  );
  const qr = await fetch(
    base + "/api/qr?url=" + encodeURIComponent(base + "/shop/" + shop),
    { headers: { cookie: owner } },
  );
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get("content-type"), "image/png");
  assert.equal(
    (
      await req("/api/qr?url=" + encodeURIComponent("https://evil.example"), {
        cookie: owner,
      })
    ).r.status,
    400,
  );
  await req("/api/settings", {
    method: "PATCH",
    cookie: owner,
    body: { bw: 5, color: 15, isOpen: false },
  });
  assert.equal(
    (
      await req("/api/shops/" + shop + "/jobs", {
        method: "POST",
        body: form(),
      })
    ).r.status,
    409,
  );
  assert.equal(
    (await req("/api/logout", { method: "POST", cookie: owner })).r.status,
    200,
  );
  assert.equal((await req("/api/me", { cookie: owner })).r.status, 401);
  const html = await fetch(base + "/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /QRBD/);
  assert.equal(
    (await req("/api/health")).value.printing,
    "manual + opt-in device agent",
  );
});
