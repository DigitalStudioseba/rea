import { fileExpired, ACTIVE_FILE_TTL } from "./job-lifetime.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { photoSheet, resumePDF, printOptions, routeFor } from "./documents.mjs";
import { AamarPay, protect, unprotect, validPayment } from "./payments.mjs";
import { installWhatsApp } from "./whatsapp.mjs";

export function migrate(db) {
  const add = (table, column, type) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add("shops", "duplex_enabled", "INTEGER NOT NULL DEFAULT 0");
  add("shops", "photo_rate", "INTEGER NOT NULL DEFAULT 3000");
  add("shops", "resume_rate", "INTEGER NOT NULL DEFAULT 2000");
  add("shops", "activated", "INTEGER NOT NULL DEFAULT 0");
  for (const [col, type] of Object.entries({
    kind: "TEXT NOT NULL DEFAULT 'document'",
    duplex: "TEXT NOT NULL DEFAULT 'off'",
    source: "TEXT NOT NULL DEFAULT 'web'",
    device: "TEXT",
    payment_method: "TEXT NOT NULL DEFAULT 'unpaid'",
  }))
    add("jobs", col, type);
  db.exec(`CREATE TABLE IF NOT EXISTS gateways(shop TEXT PRIMARY KEY REFERENCES shops(id),config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS routing(shop TEXT PRIMARY KEY REFERENCES shops(id),config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),name TEXT NOT NULL,token TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1,last_seen INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target TEXT NOT NULL,shop TEXT NOT NULL,amount INTEGER NOT NULL,mode TEXT NOT NULL,config TEXT NOT NULL,url TEXT,status TEXT NOT NULL,created INTEGER NOT NULL,verified INTEGER);
 CREATE INDEX IF NOT EXISTS payment_target ON payments(kind,target);
 CREATE TABLE IF NOT EXISTS referrals(referred TEXT PRIMARY KEY REFERENCES shops(id),referrer TEXT NOT NULL REFERENCES shops(id),created INTEGER NOT NULL,reward INTEGER NOT NULL DEFAULT 0,earned INTEGER);
 CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),amount INTEGER NOT NULL,destination TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS whatsapp_messages(id TEXT PRIMARY KEY,created INTEGER NOT NULL,status TEXT NOT NULL,job TEXT);
 `);
}
export function installFeatures(c) {
  const {
    app,
    db,
    owner,
    wrap,
    error,
    id,
    digest,
    files,
    createJob,
    jobView,
    upload,
    limit,
    root,
  } = c;
  const findShop = (shop) => {
    const s = db.prepare("SELECT * FROM shops WHERE id=?").get(shop);
    if (!s) throw error("দোকান পাওয়া যায়নি।", 404);
    return s;
  };
  const defaultRouting = { bw: "", color: "", duplex: "", photo: "" };
  const getRouting = (shop) => ({
    ...defaultRouting,
    ...JSON.parse(
      db.prepare("SELECT config FROM routing WHERE shop=?").get(shop)?.config ||
        "{}",
    ),
  });
  function device(req, res, next) {
    const token = req.get("authorization")?.replace(/^Bearer /, "");
    const d =
      token &&
      db
        .prepare("SELECT * FROM devices WHERE token=? AND enabled=1")
        .get(digest(token));
    if (!d)
      return res.status(401).json({ error: "Device token invalid or revoked" });
    req.device = d;
    db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(
      Date.now(),
      d.id,
    );
    next();
  }
  app.get("/api/features", owner, (req, res) =>
    res.json({
      routing: getRouting(req.shop.id),
      duplex: !!req.shop.duplex_enabled,
      photoRate: req.shop.photo_rate / 100,
      resumeRate: req.shop.resume_rate / 100,
      activated: !!req.shop.activated,
      gateway: gatewaySummary(req.shop.id),
      whatsapp: {
        configured: !!(
          process.env.WA_APP_SECRET &&
          process.env.WA_ACCESS_TOKEN &&
          process.env.WA_VERIFY_TOKEN &&
          process.env.WA_PHONE_NUMBER_ID &&
          process.env.WA_SHOP_ID === req.shop.id
        ),
      },
      platformBilling: !!platformConfig(),
      activationPrice: activationAmount() / 100,
    }),
  );
  app.patch("/api/features", owner, (req, res) => {
    const { routing = {}, duplex, photoRate, resumeRate } = req.body;
    if (
      typeof duplex !== "boolean" ||
      ![photoRate, resumeRate].every(
        (x) =>
          Number.isFinite(Number(x)) && Number(x) >= 1 && Number(x) <= 10000,
      )
    )
      throw error("সঠিক feature rate ও duplex status দিন।");
    const routes = {};
    for (const key of Object.keys(defaultRouting)) {
      routes[key] = String(routing[key] || "").trim();
      if (
        routes[key].startsWith("-") ||
        routes[key].length > 150 ||
        /[\x00-\x1f]/.test(routes[key])
      )
        throw error("Printer name সঠিক নয়।");
    }
    if (duplex && !routes.duplex)
      throw error("Duplex চালু করতে duplex printer name দিন।");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE shops SET duplex_enabled=?,photo_rate=?,resume_rate=? WHERE id=?",
      ).run(
        duplex ? 1 : 0,
        Math.round(Number(photoRate) * 100),
        Math.round(Number(resumeRate) * 100),
        req.shop.id,
      );
      db.prepare(
        "INSERT INTO routing VALUES(?,?) ON CONFLICT(shop) DO UPDATE SET config=excluded.config",
      ).run(req.shop.id, JSON.stringify(routes));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json({ ok: true });
  });
  async function generated(req, res, document, options) {
    const s = findShop(req.params.id);
    if (!s.is_open) throw error("দোকান বন্ধ আছে।", 409);
    res.status(201).json(jobView(createJob(s, document, options)));
  }
  app.post(
    "/api/shops/:id/photo",
    limit("upload", 40),
    upload.single("photo"),
    wrap(async (req, res) => {
      if (req.body.consent !== "yes" || !req.file)
        throw error("ছবি ও সম্মতি দিন।");
      const s = findShop(req.params.id);
      if (!s.is_open) throw error("দোকান বন্ধ আছে।", 409);
      const options = printOptions({ copies: req.body.copies, color: "color" }),
        doc = await photoSheet(req.file.buffer, {
          count: req.body.count,
          size: req.body.size,
        });
      await generated(req, res, doc, { ...options, kind: "photo" });
    }),
  );
  app.post(
    "/api/shops/:id/resume",
    limit("upload", 40),
    wrap(async (req, res) => {
      if (req.body.consent !== "yes") throw error("সম্মতি দিন।");
      const s = findShop(req.params.id);
      if (!s.is_open) throw error("দোকান বন্ধ আছে।", 409);
      const options = printOptions(req.body),
        doc = await resumePDF(req.body);
      await generated(req, res, doc, { ...options, kind: "resume" });
    }),
  );
  app.get("/api/devices", owner, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,enabled,last_seen FROM devices WHERE shop=? ORDER BY rowid DESC",
        )
        .all(req.shop.id),
    ),
  );
  app.post("/api/devices", owner, (req, res) => {
    const name = String(req.body.name || "").trim();
    if (name.length < 2 || name.length > 60)
      throw error("Device name ২–৬০ অক্ষর দিন।");
    const token = randomBytes(32).toString("hex"),
      deviceId = id();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE devices SET enabled=0 WHERE shop=?").run(req.shop.id);
      db.prepare("INSERT INTO devices(id,shop,name,token) VALUES(?,?,?,?)").run(
        deviceId,
        req.shop.id,
        name,
        digest(token),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.status(201).json({
      id: deviceId,
      token,
      notice: "Token শুধু একবার দেখানো হচ্ছে। পুরোনো device revoke হয়েছে।",
    });
  });
  app.delete("/api/devices/:id", owner, (req, res) => {
    const result = db
      .prepare("UPDATE devices SET enabled=0 WHERE id=? AND shop=?")
      .run(req.params.id, req.shop.id);
    if (!result.changes) throw error("Device পাওয়া যায়নি।", 404);
    res.json({ ok: true });
  });
  app.get("/downloads/windows-agent.py", (req, res) =>
    res.download(
      path.join(root, "agent/windows_agent.py"),
      "qrbd-windows-agent.py",
    ),
  );
  app.get("/api/agent/info", device, (req, res) =>
    res.json({ shop: req.device.shop, routing: getRouting(req.device.shop) }),
  );
  app.post("/api/agent/claim", device, (req, res) => {
    db.exec("BEGIN IMMEDIATE");
    let j;
    try {
      // Only one unresolved physical job per device; never auto-redeliver ambiguous work.
      const outstanding = db
        .prepare(
          "SELECT id FROM jobs WHERE device=? AND status IN ('printing','attention')",
        )
        .get(req.device.id);
      if (outstanding) {
        db.exec("COMMIT");
        return res.json({ job: null, attention: outstanding.id });
      }
      j = db
        .prepare(
          "SELECT * FROM jobs WHERE shop=? AND status='queued' AND deleted=0 AND created>? ORDER BY created,id LIMIT 1",
        )
        .get(req.device.shop, Date.now() - ACTIVE_FILE_TTL);
      if (!j) {
        db.exec("COMMIT");
        return res.json({ job: null });
      }
      const route = routeFor(j),
        printer =
          req.body.platform === "android"
            ? "Android print service"
            : getRouting(j.shop)[route];
      if (!printer) {
        db.exec("COMMIT");
        return res.json({
          job: null,
          error: `Printer route missing: ${route}`,
        });
      }
      db.prepare(
        "UPDATE jobs SET status='printing',device=?,updated=? WHERE id=? AND status='queued'",
      ).run(req.device.id, Date.now(), j.id);
      db.exec("COMMIT");
      const bytes = fs.readFileSync(path.join(files, j.id + ".pdf"));
      res.json({
        job: {
          id: j.id,
          pages: j.pages,
          copies: j.copies,
          color: !!j.color,
          duplex: j.duplex,
          kind: j.kind,
          printer,
          size: j.kind === "photo" ? "custom" : "A4",
          sha256: digest(bytes),
          bytes: bytes.length,
        },
      });
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  });
  function ownedDeviceJob(req) {
    const j = db
      .prepare("SELECT * FROM jobs WHERE id=? AND shop=? AND device=?")
      .get(req.params.id, req.device.shop, req.device.id);
    if (!j) throw error("Job not assigned to this device", 404);
    return j;
  }
  app.get("/api/agent/jobs/:id/document", device, (req, res) => {
    const j = ownedDeviceJob(req);
    if (j.deleted || j.status !== "printing")
      throw error("Job not printable", 409);
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(files, j.id + ".pdf"));
  });
  app.post("/api/agent/jobs/:id/report", device, (req, res) => {
    const j = ownedDeviceJob(req),
      status = req.body.status;
    if (!["submitted", "attention"].includes(status))
      throw error("Expected submitted or attention");
    if (j.status === status) return res.json({ ok: true }); // report retries are idempotent, printing is not retried
    if (j.status !== "printing")
      throw error("Job state no longer permits this report", 409);
    db.prepare("UPDATE jobs SET status=?,updated=? WHERE id=?").run(
      status,
      Date.now(),
      j.id,
    );
    res.json({
      ok: true,
      notice:
        "Spool submission is not physical completion. Owner must confirm output.",
    });
  });
  function gatewaySummary(shop) {
    const row = db
      .prepare("SELECT config FROM gateways WHERE shop=?")
      .get(shop);
    if (!row) return { configured: false };
    try {
      const v = unprotect(row.config, process.env.QRBD_SECRET_KEY);
      return { configured: true, mode: v.mode, store: v.store };
    } catch {
      return { configured: false, error: "Encryption key missing or changed" };
    }
  }
  app.put("/api/gateway", owner, (req, res) => {
    const { store, signature, mode } = req.body;
    if (
      !["sandbox", "live"].includes(mode) ||
      !/^[-a-zA-Z0-9_]{2,100}$/.test(store || "") ||
      typeof signature !== "string" ||
      signature.length < 5 ||
      signature.length > 200
    )
      throw error("aamarPay store, signature ও mode দিন।");
    const config = protect(
      { store, signature, mode },
      process.env.QRBD_SECRET_KEY,
    );
    db.prepare(
      "INSERT INTO gateways VALUES(?,?) ON CONFLICT(shop) DO UPDATE SET config=excluded.config",
    ).run(req.shop.id, config);
    res.json({ ok: true });
  });
  app.delete("/api/gateway", owner, (req, res) => {
    db.prepare("DELETE FROM gateways WHERE shop=?").run(req.shop.id);
    res.json({ ok: true });
  });
  function platformConfig() {
    return process.env.QRBD_BILLING_STORE && process.env.QRBD_BILLING_SIGNATURE
      ? {
          store: process.env.QRBD_BILLING_STORE,
          signature: process.env.QRBD_BILLING_SIGNATURE,
          mode: process.env.QRBD_BILLING_MODE === "live" ? "live" : "sandbox",
        }
      : null;
  }
  function activationAmount() {
    const n = Number(process.env.QRBD_ACTIVATION_TAKA || 500);
    return Number.isFinite(n) && n >= 100 && n <= 100000
      ? Math.round(n * 100)
      : 50000;
  }
  function publicBase() {
    try {
      const u = new URL(process.env.QRBD_PUBLIC_URL);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        throw Error();
      return u.origin;
    } catch {
      throw error("Server-এ সঠিক HTTPS QRBD_PUBLIC_URL configure করুন।", 503);
    }
  }
  const provider = (config) => new AamarPay(config);
  async function startPayment({
    kind,
    target,
    shop,
    amount,
    config,
    customer,
  }) {
    // A prior checkout is reused, never create competing live transactions per order.
    const prior = db
      .prepare(
        "SELECT * FROM payments WHERE kind=? AND target=? AND status IN ('creating','pending','verified','uncertain') ORDER BY created DESC LIMIT 1",
      )
      .get(kind, target);
    if (prior) {
      if (prior.status === "pending" && prior.url)
        return { id: prior.id, url: prior.url, mode: prior.mode };
      throw error(
        "আগের payment verify করুন; duplicate checkout বন্ধ রাখা হয়েছে।",
        409,
      );
    }
    if (
      !customer ||
      String(customer.name || "").trim().length < 2 ||
      String(customer.name).length > 80 ||
      !/^\S+@\S+\.\S+$/.test(customer.email || "") ||
      String(customer.email).length > 160 ||
      !/^\+?[0-9]{8,15}$/.test(customer.phone || "")
    )
      throw error("Payment-এর জন্য নাম, email ও phone দিন।");
    const base = publicBase(),
      transaction = "QRBD" + id(),
      snapshot = protect(config, process.env.QRBD_SECRET_KEY);
    db.prepare(
      "INSERT INTO payments(id,kind,target,shop,amount,mode,config,status,created) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      transaction,
      kind,
      target,
      shop,
      amount,
      config.mode,
      snapshot,
      "creating",
      Date.now(),
    );
    try {
      const url = await provider(config).checkout({
        transaction,
        amount,
        customer,
        callback: base + "/payments/return/" + target,
      });
      db.prepare("UPDATE payments SET status='pending',url=? WHERE id=?").run(
        url,
        transaction,
      );
      return { id: transaction, url, mode: config.mode };
    } catch {
      db.prepare("UPDATE payments SET status='uncertain' WHERE id=?").run(
        transaction,
      );
      throw error(
        "Provider থেকে checkout নিশ্চিত হয়নি। পুনরায় টাকা দেবেন না; verify বা support নিন।",
        502,
      );
    }
  }
  async function verifyPayment(payment) {
    if (payment.status === "verified")
      return { paid: true, mode: payment.mode };
    const config = unprotect(payment.config, process.env.QRBD_SECRET_KEY);
    let result;
    try {
      result = await provider(config).verify(payment.id);
    } catch {
      throw error(
        "Provider verification পাওয়া যায়নি। পরে আবার verify করুন।",
        502,
      );
    }
    if (
      !validPayment(
        result,
        { amount: payment.amount },
        payment.id,
        config.store,
      )
    )
      return { paid: false, mode: payment.mode };
    db.exec("BEGIN IMMEDIATE");
    try {
      const p = db.prepare("SELECT * FROM payments WHERE id=?").get(payment.id);
      if (p.status !== "verified") {
        if (payment.mode === "live") {
          if (p.kind === "print") {
            const job = db
              .prepare("SELECT * FROM jobs WHERE id=?")
              .get(p.target);
            if (
              !job ||
              job.deleted ||
              job.status !== "pending" ||
              fileExpired(job)
            ) {
              db.prepare(
                "UPDATE payments SET status='paid_late',verified=? WHERE id=?",
              ).run(Date.now(), p.id);
              db.exec("COMMIT");
              return {
                paid: true,
                late: true,
                mode: "live",
                notice:
                  "Paid after job closed. Shop must reconcile/refund; do not reprint automatically.",
              };
            }
            db.prepare(
              "UPDATE jobs SET status='queued',payment_method='online',updated=? WHERE id=? AND status='pending'",
            ).run(Date.now(), job.id);
          } else {
            db.prepare("UPDATE shops SET activated=1 WHERE id=?").run(p.shop);
            db.prepare(
              "UPDATE referrals SET reward=10000,earned=? WHERE referred=? AND earned IS NULL",
            ).run(Date.now(), p.shop);
          }
        }
        db.prepare(
          "UPDATE payments SET status='verified',verified=? WHERE id=?",
        ).run(Date.now(), p.id);
      }
      db.exec("COMMIT");
      return {
        paid: true,
        mode: payment.mode,
        notice:
          payment.mode === "sandbox"
            ? "Sandbox test only: no print released, no activation or real commission."
            : undefined,
      };
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }
  app.post(
    "/api/receipt/:id/checkout",
    limit("checkout", 20),
    wrap(async (req, res) => {
      const j = db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
      if (!j || j.status !== "pending" || j.deleted || fileExpired(j))
        throw error("Active unpaid order প্রয়োজন।", 409);
      const gateway = db
        .prepare("SELECT config FROM gateways WHERE shop=?")
        .get(j.shop);
      if (!gateway)
        throw error("দোকানে online payment configure করা নেই।", 503);
      const config = unprotect(gateway.config, process.env.QRBD_SECRET_KEY);
      res.json(
        await startPayment({
          kind: "print",
          target: j.id,
          shop: j.shop,
          amount: j.amount,
          config,
          customer: req.body,
        }),
      );
    }),
  );
  app.post(
    "/api/receipt/:id/verify",
    limit("verify", 80),
    wrap(async (req, res) => {
      const p = db
        .prepare(
          "SELECT * FROM payments WHERE kind='print' AND target=? ORDER BY created DESC LIMIT 1",
        )
        .get(req.params.id);
      if (!p) throw error("কোনো payment attempt নেই।", 404);
      res.json(await verifyPayment(p));
    }),
  );
  // Provider/browser return is navigation only. It never trusts POSTed success or marks payment paid.
  app.all("/payments/return/:id", (req, res) => {
    const p = db
      .prepare(
        "SELECT * FROM payments WHERE target=? ORDER BY created DESC LIMIT 1",
      )
      .get(req.params.id);
    res.redirect(
      303,
      p?.kind === "print"
        ? "/shop/" + p.shop + "?receipt=" + p.target
        : "/dashboard",
    );
  });
  app.post(
    "/api/billing/checkout",
    owner,
    limit("checkout", 20),
    wrap(async (req, res) => {
      if (req.shop.activated) throw error("দোকান আগেই activated।", 409);
      const config = platformConfig();
      if (!config) throw error("Platform billing configure করা নেই।", 503);
      res.json(
        await startPayment({
          kind: "activation",
          target: req.shop.id,
          shop: req.shop.id,
          amount: activationAmount(),
          config,
          customer: req.body,
        }),
      );
    }),
  );
  app.post(
    "/api/billing/verify",
    owner,
    limit("verify", 80),
    wrap(async (req, res) => {
      const p = db
        .prepare(
          "SELECT * FROM payments WHERE kind='activation' AND target=? ORDER BY created DESC LIMIT 1",
        )
        .get(req.shop.id);
      if (!p) throw error("কোনো activation payment নেই।", 404);
      res.json(await verifyPayment(p));
    }),
  );
  app.get("/api/payment-history", owner, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,kind,target,amount,mode,status,created,verified FROM payments WHERE shop=? ORDER BY created DESC LIMIT 100",
        )
        .all(req.shop.id)
        .map((p) => ({ ...p, amount: p.amount / 100 })),
    ),
  );
  app.get("/api/referrals", owner, (req, res) => {
    const shops = db
      .prepare(
        "SELECT r.created,r.reward,r.earned,s.name FROM referrals r JOIN shops s ON s.id=r.referred WHERE r.referrer=? ORDER BY r.created DESC LIMIT 100",
      )
      .all(req.shop.id)
      .map((r) => ({ ...r, reward: r.reward / 100 }));
    const earned = db
      .prepare(
        "SELECT COALESCE(SUM(reward),0) AS n FROM referrals WHERE referrer=?",
      )
      .get(req.shop.id).n;
    const reserved = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS n FROM withdrawals WHERE shop=? AND status IN ('requested','paid')",
      )
      .get(req.shop.id).n;
    res.json({
      shops,
      earned: earned / 100,
      available: (earned - reserved) / 100,
      policy:
        "প্রতি নতুন দোকানের verified LIVE platform activation-এ ৳১০০। Sandbox বা customer print payment-এ reward নয়। Minimum withdrawal ৳৫০০; manual payout.",
      withdrawals: db
        .prepare(
          "SELECT id,amount,status,reference,created FROM withdrawals WHERE shop=? ORDER BY created DESC LIMIT 50",
        )
        .all(req.shop.id)
        .map((w) => ({ ...w, amount: w.amount / 100 })),
    });
  });
  app.post("/api/withdrawals", owner, (req, res) => {
    const amount = Math.round(Number(req.body.amount) * 100),
      destination = String(req.body.destination || "").trim();
    if (
      !Number.isSafeInteger(amount) ||
      amount < 50000 ||
      amount > 1e9 ||
      !/^\+?[0-9]{11,15}$/.test(destination)
    )
      throw error("অন্তত ৳৫০০ এবং সঠিক payout mobile number দিন।");
    db.exec("BEGIN IMMEDIATE");
    try {
      const earned = db
          .prepare(
            "SELECT COALESCE(SUM(reward),0) AS n FROM referrals WHERE referrer=?",
          )
          .get(req.shop.id).n,
        reserved = db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM withdrawals WHERE shop=? AND status IN ('requested','paid')",
          )
          .get(req.shop.id).n;
      if (amount > earned - reserved)
        throw error("পর্যাপ্ত commission balance নেই।", 409);
      const wid = id();
      db.prepare(
        "INSERT INTO withdrawals(id,shop,amount,destination,status,created) VALUES(?,?,?,?,'requested',?)",
      ).run(wid, req.shop.id, amount, destination, Date.now());
      db.exec("COMMIT");
      res.status(201).json({
        id: wid,
        status: "requested",
        notice:
          "টাকা পাঠানো হয়নি। Operator verification ও manual payout প্রয়োজন।",
      });
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  });
  app.get("/manifest.webmanifest", (req, res) =>
    res.type("application/manifest+json").json({
      name: "QRBD Print",
      short_name: "QRBD",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f8f8f2",
      theme_color: "#17543f",
      icons: [
        {
          src: "/icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
    }),
  );
  installWhatsApp({ ...c, findShop });
}
