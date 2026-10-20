import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { randomBytes, createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  photoSheet,
  resumePDF,
  printOptions,
  routeFor,
} from "../lib/documents.mjs";
import {
  AamarPay,
  protect,
  unprotect,
  validPayment,
} from "../lib/payments.mjs";
import { verifySignature, captionOptions } from "../lib/whatsapp.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);
test("document tools, strict options, payment validation/encryption and WhatsApp signatures", async () => {
  assert.equal(
    routeFor({ kind: "photo", color: true, duplex: "off" }),
    "photo",
  );
  assert.equal(
    routeFor({ kind: "document", color: false, duplex: "long" }),
    "duplex",
  );
  assert.throws(() => printOptions({ copies: 99 }));
  assert.throws(() => printOptions({ duplex: "manual" }));
  for (const size of ["4x6", "a4"]) {
    const doc = await photoSheet(png, { count: 6, size });
    const pdf = await PDFDocument.load(doc.bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(
      Math.round(pdf.getPage(0).getWidth()),
      size === "a4" ? 595 : 288,
    );
  }
  await assert.rejects(photoSheet(png, { count: 100 }));
  for (const template of ["classic", "modern", "compact"]) {
    const r = await resumePDF({
      name: "Test Resume",
      template,
      summary: "Experienced software developer",
      experience: "Long experience. ".repeat(90),
    });
    assert.ok(r.pages >= 1);
    assert.ok(r.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
  }
  await assert.rejects(resumePDF({ name: "বাংলা" }));
  await assert.rejects(resumePDF({ name: "A", summary: "A".repeat(500) }));
  const key = randomBytes(32).toString("base64"),
    secret = { signature: "sample", store: "test", mode: "sandbox" },
    cipher = protect(secret, key);
  assert.deepEqual(unprotect(cipher, key), secret);
  assert.throws(() => unprotect(cipher, randomBytes(32).toString("base64")));
  assert.throws(() => protect(secret, ""));
  const r = {
    pay_status: "Successful",
    status_code: "2",
    mer_txnid: "tx",
    store_id: "shop",
    currency: "BDT",
    amount: "18.00",
  };
  assert.ok(validPayment(r, { amount: 1800 }, "tx", "shop"));
  for (const changes of [
    { amount: "17.99" },
    { currency: "USD" },
    { store_id: "other" },
    { mer_txnid: "other" },
    { status_code: "0" },
    { pay_status: "Failed" },
  ])
    assert.equal(
      validPayment({ ...r, ...changes }, { amount: 1800 }, "tx", "shop"),
      false,
    );
  const a = new AamarPay({
    store: "shop",
    signature: "signature",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          result: "true",
          payment_url: "https://evil.example/checkout",
        }),
      ),
  });
  await assert.rejects(
    a.checkout({
      transaction: "tx",
      amount: 1800,
      customer: {},
      callback: "https://shop.example/return",
    }),
  );
  const payload = Buffer.from('{"object":"whatsapp_business_account"}'),
    sig =
      "sha256=" + createHmac("sha256", "sample").update(payload).digest("hex");
  assert.equal(verifySignature(payload, sig, "sample"), true);
  assert.equal(verifySignature(Buffer.from("changed"), sig, "sample"), false);
  assert.equal(verifySignature(payload, "bad", "sample"), false);
  assert.deepEqual(captionOptions("color copies=2 duplex=long"), {
    color: true,
    copies: 2,
    duplex: "long",
  });
  assert.throws(() => captionOptions("copies=99"));
});

test("HTTP tools/devices, provider-simulated billing, referral and payout reservations", async (t) => {
  const dir = await mkdtemp(tmpdir() + "/qrbd-extended-");
  const child = spawn(
    process.execPath,
    ["--import", "./test/provider-stub.mjs", "server.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: "0",
        QRBD_DATA_DIR: dir,
        QRBD_SECRET_KEY: randomBytes(32).toString("base64"),
        QRBD_PUBLIC_URL: "https://qrbd.example",
        QRBD_BILLING_STORE: "test-store",
        QRBD_BILLING_SIGNATURE: "fixture-secret",
        QRBD_BILLING_MODE: "live",
        WA_APP_SECRET: "test-secret",
        WA_VERIFY_TOKEN: "verify",
        WA_ACCESS_TOKEN: "fixture-only",
        WA_PHONE_NUMBER_ID: "1234",
        WA_SHOP_ID: "unused",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (b) => (errors += b));
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on("data", (b) => {
      const m = b.toString().match(/0.0.0.0:(\d+)/);
      if (m) resolve(m[1]);
    });
    child.on("exit", () => reject(Error(errors)));
    setTimeout(() => reject(Error("Startup timeout " + errors)), 10000).unref();
  });
  const base = "http://127.0.0.1:" + port;
  async function call(
    url,
    { method = "GET", cookie, body, token, headers = {} } = {},
  ) {
    const r = await fetch(base + url, {
      method,
      headers: {
        "x-qrbd-request": "1",
        ...(cookie ? { cookie } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      redirect: "manual",
    });
    let v;
    try {
      v = await r.json();
    } catch {}
    return { r, v, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  }
  const register = async (email, referral) =>
    call("/api/register", {
      method: "POST",
      body: {
        name: "Test Shop",
        email,
        password: "extended-test-password",
        bw: 3,
        color: 10,
        referral,
      },
    });
  const a = await register("primary@example.com"),
    cookie = a.cookie,
    shop = a.v.id,
    b = await register("other@example.com");
  const form = () => {
    const f = new FormData();
    f.append("files", new Blob([png]), "photo.png");
    f.append("color", "bw");
    f.append("copies", "2");
    f.append("consent", "yes");
    return f;
  };
  const settings = {
    duplex: true,
    photoRate: 35,
    resumeRate: 25,
    routing: {
      bw: "B&W Printer",
      color: "Color Printer",
      photo: "Photo Printer",
      duplex: "Duplex Printer",
    },
  };
  assert.equal(
    (await call("/api/features", { cookie, method: "PATCH", body: settings })).r
      .status,
    200,
  );
  const photo = new FormData();
  photo.append("photo", new Blob([png]), "image.png");
  photo.append("count", "6");
  photo.append("size", "4x6");
  photo.append("copies", "2");
  photo.append("consent", "yes");
  const photoJob = await call("/api/shops/" + shop + "/photo", {
    method: "POST",
    body: photo,
  });
  assert.equal(photoJob.r.status, 201);
  assert.equal(photoJob.v.amount, 70);
  const resume = await call("/api/shops/" + shop + "/resume", {
    method: "POST",
    body: {
      name: "Example Person",
      summary: "Useful experience",
      consent: "yes",
      copies: 1,
      color: "bw",
      template: "modern",
    },
  });
  assert.equal(resume.r.status, 201);
  assert.equal(resume.v.amount, 25);
  const duplex = form();
  duplex.append("duplex", "long");
  const document = await call("/api/shops/" + shop + "/jobs", {
    method: "POST",
    body: duplex,
  });
  assert.equal(document.r.status, 201);
  assert.equal(
    (
      await call("/api/devices", {
        cookie,
        method: "POST",
        body: { name: "Main PC" },
      })
    ).r.status,
    201,
  );
  const device = await call("/api/devices", {
      cookie,
      method: "POST",
      body: { name: "New PC" },
    }),
    token = device.v.token;
  assert.equal(
    (await call("/api/devices", { cookie })).v.filter((d) => d.enabled).length,
    1,
  );
  const second = await call("/api/devices", {
    cookie: b.cookie,
    method: "POST",
    body: { name: "Other PC" },
  });
  assert.equal(
    (await call("/api/agent/claim", { method: "POST", token, body: {} })).v.job,
    null,
    "unpaid orders not claimable",
  );
  await call("/api/jobs/" + document.v.id, {
    cookie,
    method: "PATCH",
    body: { status: "queued" },
  });
  const claim = await call("/api/agent/claim", {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(claim.v.job.printer, "Duplex Printer");
  assert.equal(claim.v.job.duplex, "long");
  assert.equal(
    (await call("/api/agent/claim", { method: "POST", token, body: {} })).v.job,
    null,
    "claimed work never redelivered",
  );
  assert.equal(
    (
      await call("/api/agent/jobs/" + document.v.id + "/document", {
        token: second.v.token,
      })
    ).r.status,
    404,
  );
  const download = await fetch(
    base + "/api/agent/jobs/" + document.v.id + "/document",
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.equal(download.status, 200);
  assert.equal(
    (
      await call("/api/jobs/" + document.v.id, {
        cookie,
        method: "PATCH",
        body: { status: "completed" },
      })
    ).r.status,
    409,
    "owner cannot race active agent",
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await call("/api/agent/jobs/" + document.v.id + "/report", {
          method: "POST",
          token,
          body: { status: "submitted" },
        })
      ).r.status,
      200,
    );
  assert.equal(
    (
      await call("/api/jobs/" + document.v.id, {
        cookie,
        method: "PATCH",
        body: { status: "completed" },
      })
    ).r.status,
    200,
  );
  assert.equal(
    (await call("/api/devices/" + device.v.id, { cookie, method: "DELETE" })).r
      .status,
    200,
  );
  assert.equal((await call("/api/agent/info", { token })).r.status, 401);
  // A forged browser/provider redirect cannot release printing.
  const callback = await fetch(base + "/payments/return/" + photoJob.v.id, {
    method: "POST",
    headers: { origin: "https://secure.aamarpay.com" },
    redirect: "manual",
  });
  assert.equal(callback.status, 303);
  assert.equal(
    (await call("/api/receipt/" + photoJob.v.id)).v.status,
    "pending",
  );
  assert.equal(
    (
      await call("/api/gateway", {
        cookie,
        method: "PUT",
        body: {
          store: "fixture-store",
          signature: "fixture-signature",
          mode: "sandbox",
        },
      })
    ).r.status,
    200,
  );
  const customer = {
    name: "Customer",
    email: "customer@example.com",
    phone: "01700000000",
  };
  assert.equal(
    (
      await call("/api/receipt/" + photoJob.v.id + "/checkout", {
        method: "POST",
        body: customer,
      })
    ).r.status,
    200,
  );
  const sandbox = await call("/api/receipt/" + photoJob.v.id + "/verify", {
    method: "POST",
    body: {},
  });
  assert.equal(sandbox.v.paid, true);
  assert.equal(sandbox.v.mode, "sandbox");
  assert.equal(
    (await call("/api/receipt/" + photoJob.v.id)).v.status,
    "pending",
  );
  await call("/api/gateway", {
    cookie,
    method: "PUT",
    body: {
      store: "fixture-store",
      signature: "fixture-signature",
      mode: "live",
    },
  });
  assert.equal(
    (
      await call("/api/receipt/" + resume.v.id + "/checkout", {
        method: "POST",
        body: customer,
      })
    ).r.status,
    200,
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await call("/api/receipt/" + resume.v.id + "/verify", {
          method: "POST",
          body: {},
        })
      ).v.paid,
      true,
    );
  assert.equal((await call("/api/receipt/" + resume.v.id)).v.status, "queued");
  assert.equal(
    (await call("/api/receipt/" + resume.v.id)).v.payment_method,
    "online",
  );
  const bad = await call("/api/shops/" + shop + "/jobs", {
    method: "POST",
    body: form(),
  });
  await call("/api/receipt/" + bad.v.id + "/checkout", {
    method: "POST",
    body: { ...customer, name: "Mismatch" },
  });
  assert.equal(
    (
      await call("/api/receipt/" + bad.v.id + "/verify", {
        method: "POST",
        body: {},
      })
    ).v.paid,
    false,
  );
  assert.equal((await call("/api/receipt/" + bad.v.id)).v.status, "pending");
  const late = await call("/api/shops/" + shop + "/jobs", {
    method: "POST",
    body: form(),
  });
  await call("/api/receipt/" + late.v.id + "/checkout", {
    method: "POST",
    body: customer,
  });
  await call("/api/jobs/" + late.v.id, {
    cookie,
    method: "PATCH",
    body: { status: "cancelled" },
  });
  assert.equal(
    (
      await call("/api/receipt/" + late.v.id + "/verify", {
        method: "POST",
        body: {},
      })
    ).v.late,
    true,
  );
  assert.equal((await call("/api/receipt/" + late.v.id)).v.status, "cancelled");
  for (let n = 0; n < 5; n++) {
    const referred = await register("ref" + n + "@example.com", shop);
    assert.equal(
      (
        await call("/api/billing/checkout", {
          cookie: referred.cookie,
          method: "POST",
          body: customer,
        })
      ).r.status,
      200,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await call("/api/billing/verify", {
            cookie: referred.cookie,
            method: "POST",
            body: {},
          })
        ).v.paid,
        true,
      );
  }
  const referrals = await call("/api/referrals", { cookie });
  assert.equal(referrals.v.earned, 500);
  assert.equal(referrals.v.shops.length, 5);
  const payout = await call("/api/withdrawals", {
    cookie,
    method: "POST",
    body: { amount: 500, destination: "01700000000" },
  });
  assert.equal(payout.r.status, 201);
  assert.equal(payout.v.status, "requested");
  assert.equal(
    (
      await call("/api/withdrawals", {
        cookie,
        method: "POST",
        body: { amount: 500, destination: "01700000000" },
      })
    ).r.status,
    409,
    "reserved funds cannot be withdrawn twice",
  );
  assert.equal((await call("/api/referrals", { cookie })).v.available, 0);
  assert.equal(
    (await call("/api/gateway", { cookie })).r.status,
    404,
    "secrets have no GET endpoint",
  );
  assert.equal(
    (
      await fetch(
        base +
          "/integrations/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/integrations/whatsapp", {
        method: "POST",
        body: { object: "whatsapp_business_account" },
        headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) },
      })
    ).r.status,
    403,
  );
  const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [],
    }),
    signature =
      "sha256=" + createHmac("sha256", "test-secret").update(raw).digest("hex");
  assert.equal(
    (
      await fetch(base + "/integrations/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        body: raw,
      })
    ).status,
    200,
  );
  assert.equal((await fetch(base + "/manifest.webmanifest")).status, 200);
});
