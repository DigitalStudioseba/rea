import express from "express";
import { configureRuntime } from "./lib/runtime.mjs";
import { fileExpired } from "./lib/job-lifetime.mjs";
import multer from "multer";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { mergeDocuments, printOptions } from "./lib/documents.mjs";
import { installFeatures, migrate } from "./lib/features.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(
  process.env.QRBD_DATA_DIR || path.join(root, ".data"),
);
const runtime = configureRuntime(process.env, data);
const files = path.resolve(
  process.env.QRBD_FILE_DIR || path.join(data, "files"),
);
fs.mkdirSync(files, { recursive: true, mode: 0o700 });
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(data, "qrbd.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS shops(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,bw INTEGER NOT NULL,color INTEGER NOT NULL,is_open INTEGER NOT NULL DEFAULT 1,message TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),status TEXT NOT NULL,pages INTEGER NOT NULL,copies INTEGER NOT NULL,color INTEGER NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
`);
// Preserve existing local data before the additive v0.2 schema migration.
if (
  !db
    .prepare("PRAGMA table_info(shops)")
    .all()
    .some((c) => c.name === "duplex_enabled") &&
  db.prepare("SELECT COUNT(*) AS n FROM shops").get().n > 0
) {
  const backups = path.join(data, "schema-backups");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  db.prepare("VACUUM INTO ?").run(
    path.join(backups, "before-v02-" + Date.now() + ".sqlite"),
  );
}
migrate(db);
const app = express();
app.disable("x-powered-by");
if (runtime.proxyHops) app.set("trust proxy", runtime.proxyHops);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  if (process.env.QRBD_EMBED_PREVIEW === "1") {
    res.removeHeader("X-Frame-Options");
    res.set(
      "Content-Security-Policy",
      res.get("Content-Security-Policy").replace(" frame-ancestors 'none'", ""),
    );
  }
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !req.path.startsWith("/payments/return/") &&
    req.path !== "/integrations/whatsapp"
  ) {
    if (req.get("x-qrbd-request") !== "1")
      return res
        .status(403)
        .json({ error: "অনুমোদিত QRBD পেজ থেকে চেষ্টা করুন।" });
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host"))
          return res.status(403).json({ error: "Origin rejected" });
      } catch {
        return res.status(403).json({ error: "Invalid origin" });
      }
    }
  }
  next();
});
const jsonParser = express.json({ limit: "32kb" });
app.use((req, res, next) =>
  req.path === "/integrations/whatsapp" ? next() : jsonParser(req, res, next),
);
const id = () => randomBytes(12).toString("hex");
const digest = (s) => createHash("sha256").update(s).digest("hex");
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const wrap = (f) => (req, res, next) =>
  Promise.resolve(f(req, res, next)).catch(next);
function shopPublic(s) {
  return {
    id: s.id,
    name: s.name,
    bw: s.bw / 100,
    color: s.color / 100,
    isOpen: !!s.is_open,
    message: s.message,
    duplex: !!s.duplex_enabled,
    photoRate: s.photo_rate / 100,
    resumeRate: s.resume_rate / 100,
    online: !!db.prepare("SELECT 1 FROM gateways WHERE shop=?").get(s.id),
  };
}
function rates(body) {
  const a = Number(body.bw),
    b = Number(body.color);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < 1 ||
    b < 1 ||
    a > 10000 ||
    b > 10000
  )
    throw error("প্রতি পাতার মূল্য ৳১ থেকে ৳১০,০০০ দিন।");
  return [Math.round(a * 100), Math.round(b * 100)];
}
function owner(req, res, next) {
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("qrbd_session="))
    ?.slice(13);
  const session =
    token &&
    db
      .prepare("SELECT shop FROM sessions WHERE token=? AND expires>?")
      .get(digest(token), Date.now());
  if (!session) return res.status(401).json({ error: "প্রথমে লগইন করুন।" });
  req.shop = db.prepare("SELECT * FROM shops WHERE id=?").get(session.shop);
  next();
}
function session(res, shop, req) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    shop,
    Date.now() + 7 * 864e5,
  );
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.setHeader(
    "Set-Cookie",
    `qrbd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`,
  );
}
const buckets = new Map();
function limit(kind, max) {
  return (req, res, next) => {
    const key = kind + ":" + req.ip,
      now = Date.now();
    let b = buckets.get(key);
    if (!b || b.until < now) {
      b = { n: 0, until: now + 15 * 60e3 };
      buckets.set(key, b);
    }
    if (++b.n > max)
      return res
        .status(429)
        .json({ error: "অনেকবার চেষ্টা হয়েছে। ১৫ মিনিট পরে চেষ্টা করুন।" });
    next();
  };
}
app.post(
  "/api/register",
  limit("auth", 30),
  wrap(async (req, res) => {
    if (process.env.QRBD_REGISTRATION_CODE) {
      const expected = createHash("sha256")
        .update(process.env.QRBD_REGISTRATION_CODE)
        .digest();
      const supplied = createHash("sha256")
        .update(String(req.body.invitationCode || ""))
        .digest();
      if (!timingSafeEqual(expected, supplied))
        throw error(
          "দোকান নিবন্ধনের private beta invitation code সঠিক নয়।",
          403,
        );
    }
    const name = String(req.body.name || "").trim(),
      email = String(req.body.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body.password || "");
    if (
      name.length < 2 ||
      name.length > 80 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 160 ||
      password.length < 10 ||
      Buffer.byteLength(password) > 72
    )
      throw error("দোকানের নাম, সঠিক email ও ১০–৭২ বাইটের password দিন।");
    const [bw, color] = rates(req.body),
      shop = id(),
      hash = await bcrypt.hash(password, 12);
    try {
      db.prepare(
        "INSERT INTO shops(id,name,email,password,bw,color,created) VALUES(?,?,?,?,?,?,?)",
      ).run(shop, name, email, hash, bw, color, Date.now());
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        throw error("এই email আগে নিবন্ধিত হয়েছে।", 409);
      throw e;
    }
    const referral = String(req.body.referral || "");
    if (
      referral &&
      referral !== shop &&
      db.prepare("SELECT 1 FROM shops WHERE id=?").get(referral)
    )
      db.prepare(
        "INSERT INTO referrals(referred,referrer,created) VALUES(?,?,?)",
      ).run(shop, referral, Date.now());
    session(res, shop, req);
    res.status(201).json({ id: shop });
  }),
);
const dummyHash = bcrypt.hashSync("not-a-real-account-password", 12);
app.post(
  "/api/login",
  limit("auth", 30),
  wrap(async (req, res) => {
    const s = db.prepare("SELECT * FROM shops WHERE email=?").get(
      String(req.body.email || "")
        .trim()
        .toLowerCase(),
    );
    const valid = await bcrypt.compare(
      String(req.body.password || "").slice(0, 100),
      s?.password || dummyHash,
    );
    if (!s || !valid) throw error("Email বা password সঠিক নয়।", 401);
    session(res, s.id, req);
    res.json({ id: s.id });
  }),
);
app.post("/api/logout", owner, (req, res) => {
  const raw = req.headers.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("qrbd_session="))
    .slice(13);
  db.prepare("DELETE FROM sessions WHERE token=?").run(digest(raw));
  res.setHeader(
    "Set-Cookie",
    "qrbd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/me", owner, (req, res) =>
  res.json({ ...shopPublic(req.shop), email: req.shop.email }),
);
app.patch("/api/settings", owner, (req, res, next) => {
  try {
    const [bw, color] = rates(req.body),
      message = String(req.body.message || "").slice(0, 200);
    if (typeof req.body.isOpen !== "boolean")
      throw error("দোকানের status সঠিক নয়।");
    db.prepare(
      "UPDATE shops SET bw=?,color=?,is_open=?,message=? WHERE id=?",
    ).run(bw, color, req.body.isOpen ? 1 : 0, message, req.shop.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.get("/api/shops/:id", (req, res) => {
  const s = db.prepare("SELECT * FROM shops WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "দোকান পাওয়া যায়নি।" });
  res.json(shopPublic(s));
});
app.get(
  "/api/qr",
  owner,
  wrap(async (req, res) => {
    const target = String(req.query.url || "");
    let url;
    try {
      url = new URL(target);
    } catch {
      throw error("QR URL সঠিক নয়।");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.host !== req.get("host") ||
      url.pathname !== `/shop/${req.shop.id}`
    )
      throw error("নিজের দোকানের URL ব্যবহার করুন।");
    res.type("png").send(
      await QRCode.toBuffer(url.href, {
        width: 720,
        margin: 3,
        errorCorrectionLevel: "M",
      }),
    );
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 8, parts: 13 },
});
function createJob(shop, document, options) {
  const job = id(),
    now = Date.now();
  const amount =
    options.kind === "photo"
      ? shop.photo_rate * options.copies
      : options.kind === "resume"
        ? shop.resume_rate * options.copies
        : document.pages *
          options.copies *
          (options.color ? shop.color : shop.bw);
  fs.writeFileSync(path.join(files, job + ".pdf"), document.bytes, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    db.prepare(
      "INSERT INTO jobs(id,shop,status,pages,copies,color,amount,created,updated,kind,duplex,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      job,
      shop.id,
      "pending",
      document.pages,
      options.copies,
      options.color ? 1 : 0,
      amount,
      now,
      now,
      options.kind,
      options.duplex,
      options.source || "web",
    );
  } catch (e) {
    fs.unlinkSync(path.join(files, job + ".pdf"));
    throw e;
  }
  return db.prepare("SELECT * FROM jobs WHERE id=?").get(job);
}
app.post(
  "/api/shops/:id/jobs",
  limit("upload", 40),
  upload.array("files", 5),
  wrap(async (req, res) => {
    const s = db.prepare("SELECT * FROM shops WHERE id=?").get(req.params.id);
    if (!s) throw error("দোকান পাওয়া যায়নি।", 404);
    if (!s.is_open) throw error("দোকান এখন বন্ধ আছে।", 409);
    const options = printOptions(req.body);
    if (req.body.consent !== "yes")
      throw error("ফাইল প্রক্রিয়াকরণে সম্মতি প্রয়োজন।");
    if (options.duplex !== "off" && !s.duplex_enabled)
      throw error("এই দোকানে duplex চালু নেই।");
    const document = await mergeDocuments(req.files);
    const current = db.prepare("SELECT * FROM shops WHERE id=?").get(s.id);
    if (
      !current.is_open ||
      current.bw !== s.bw ||
      current.color !== s.color ||
      current.duplex_enabled !== s.duplex_enabled
    )
      throw error("দোকানের অবস্থা বা মূল্য বদলেছে। আবার চেষ্টা করুন।", 409);
    res
      .status(201)
      .json(jobView(createJob(s, document, { ...options, kind: "document" })));
  }),
);
function jobView(j) {
  return {
    ...j,
    color: !!j.color,
    amount: j.amount / 100,
    deleted: !!j.deleted,
  };
}
app.get("/api/receipt/:id", (req, res) => {
  const j = db
    .prepare(
      "SELECT id,shop,status,pages,copies,color,amount,created,deleted,kind,duplex,payment_method FROM jobs WHERE id=?",
    )
    .get(req.params.id);
  if (!j) return res.status(404).json({ error: "অর্ডার পাওয়া যায়নি।" });
  res.json(jobView(j));
});
app.get("/api/jobs", owner, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM jobs WHERE shop=? ORDER BY created DESC LIMIT 200",
      )
      .all(req.shop.id)
      .map(jobView),
  ),
);
const transitions = {
  pending: ["queued", "cancelled"],
  queued: ["printing", "cancelled"],
  printing: ["completed", "failed"],
  submitted: ["completed", "failed"],
  attention: ["completed", "failed"],
};
function removeFile(job) {
  try {
    fs.unlinkSync(path.join(files, job + ".pdf"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  db.prepare("UPDATE jobs SET deleted=1 WHERE id=?").run(job);
}
app.patch("/api/jobs/:id", owner, (req, res, next) => {
  try {
    const j = db
      .prepare("SELECT * FROM jobs WHERE id=? AND shop=?")
      .get(req.params.id, req.shop.id);
    if (!j) throw error("অর্ডার পাওয়া যায়নি।", 404);
    if (fileExpired(j)) throw error("অর্ডারের ফাইলের মেয়াদ শেষ।", 409);
    const status = req.body.status;
    if (j.device && j.status === "printing")
      throw error(
        "Agent কাজ করছে। আগে agent report বা ১৫ মিনিট timeout-এর জন্য অপেক্ষা করুন।",
        409,
      );
    if (!transitions[j.status]?.includes(status))
      throw error("এই status পরিবর্তন অনুমোদিত নয়।", 409);
    if (["completed", "failed", "cancelled"].includes(status)) removeFile(j.id);
    db.prepare(
      "UPDATE jobs SET status=?,updated=?,payment_method=CASE WHEN ?='queued' THEN 'counter' ELSE payment_method END WHERE id=? AND status=?",
    ).run(status, Date.now(), status, j.id, j.status);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.get("/api/jobs/:id/document", owner, (req, res, next) => {
  const j = db
    .prepare("SELECT * FROM jobs WHERE id=? AND shop=?")
    .get(req.params.id, req.shop.id);
  if (!j) return res.status(404).json({ error: "অর্ডার পাওয়া যায়নি।" });
  if (
    !["queued", "printing", "submitted", "attention"].includes(j.status) ||
    j.deleted
  )
    return res
      .status(409)
      .json({ error: "পেমেন্ট নিশ্চিত করার পরে active document খোলা যাবে।" });
  res.set({
    "Cache-Control": "no-store",
    "Content-Disposition": 'inline; filename="qrbd-print.pdf"',
  });
  res.sendFile(path.join(files, j.id + ".pdf"), (err) => {
    if (err) next(err);
  });
});
function cleanup() {
  const now = Date.now();
  db.prepare(
    "UPDATE jobs SET status='attention',updated=? WHERE status='printing' AND device IS NOT NULL AND updated<?",
  ).run(now, now - 15 * 60e3);
  for (const j of db.prepare("SELECT * FROM jobs WHERE deleted=0").all()) {
    if (
      !fs.existsSync(path.join(files, j.id + ".pdf")) &&
      !["completed", "failed", "cancelled"].includes(j.status)
    ) {
      db.prepare(
        "UPDATE jobs SET status='file_lost',deleted=1,updated=? WHERE id=?",
      ).run(now, j.id);
      continue;
    }
    const expired = fileExpired(j, now);
    if (expired || ["completed", "failed", "cancelled"].includes(j.status)) {
      try {
        removeFile(j.id);
        if (expired)
          db.prepare(
            "UPDATE jobs SET status='expired',updated=? WHERE id=?",
          ).run(now, j.id);
      } catch {
        console.error("File cleanup failed for job", j.id);
      }
    }
  }
  // Recover unreferenced files left behind by interruption during upload.
  for (const name of fs.readdirSync(files)) {
    if (
      /^[a-f0-9]{24}\.pdf$/.test(name) &&
      !db.prepare("SELECT 1 FROM jobs WHERE id=?").get(name.slice(0, -4))
    )
      fs.unlinkSync(path.join(files, name));
  }
  db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
  db.prepare("DELETE FROM jobs WHERE deleted=1 AND created<?").run(
    now - 7 * 864e5,
  );
  for (const [key, b] of buckets) if (b.until < now) buckets.delete(key);
}
installFeatures({
  app,
  db,
  owner,
  wrap,
  error,
  id,
  digest,
  data,
  files,
  createJob,
  jobView,
  upload,
  limit,
  root,
});
cleanup();
setInterval(() => {
  try {
    cleanup();
  } catch (e) {
    console.error("Scheduled cleanup failed:", e.message);
  }
}, 60000).unref();
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    version: "0.2.0",
    payments: "counter + configurable aamarpay",
    printing: "manual + opt-in device agent",
  }),
);
app.use(express.static(path.join(root, "public")));
app.get(
  ["/", "/dashboard", "/shop/:id", "/tools/:id", "/connect"],
  (req, res) => res.sendFile(path.join(root, "public/index.html")),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;
  if (status >= 500) console.error("Request failed:", err.message);
  res.status(status).json({
    error:
      status >= 500
        ? "সার্ভারে সমস্যা হয়েছে। পরে চেষ্টা করুন।"
        : err instanceof multer.MulterError
          ? "ফাইলের সীমা অতিক্রম হয়েছে: প্রতি ফাইল ১০ MB, সর্বোচ্চ ৫টি।"
          : err.message,
  });
});
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`QRBD listening on 0.0.0.0:${server.address().port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
