import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

test("v0.1 migration backup, restart retention and ambiguous agent recovery", async () => {
  const data = await mkdtemp(tmpdir() + "/qrbd-recovery-");
  let process;
  const filename = data + "/qrbd.sqlite",
    shop = "a".repeat(24),
    expired = "b".repeat(24),
    active = "c".repeat(24),
    orphan = "d".repeat(24),
    old = "e".repeat(24),
    token = "f".repeat(64),
    now = Date.now();
  try {
    await mkdir(data + "/files");
    const db = new DatabaseSync(filename);
    db.exec(`CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,bw INTEGER NOT NULL,color INTEGER NOT NULL,is_open INTEGER NOT NULL DEFAULT 1,message TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
  CREATE TABLE sessions(token TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),expires INTEGER NOT NULL);
  CREATE TABLE jobs(id TEXT PRIMARY KEY,shop TEXT NOT NULL REFERENCES shops(id),status TEXT NOT NULL,pages INTEGER NOT NULL,copies INTEGER NOT NULL,color INTEGER NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);`);
    db.prepare(
      "INSERT INTO shops(id,name,email,password,bw,color,created) VALUES(?,?,?,?,?,?,?)",
    ).run(
      shop,
      "Existing Shop",
      "existing@example.com",
      bcrypt.hashSync("existing-password", 4),
      300,
      1000,
      now,
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      shop,
      now + 864e5,
    );
    for (const [id, status, created, deleted] of [
      [expired, "pending", now - 2 * 3600e3, 0],
      [active, "queued", now, 0],
      [old, "completed", now - 8 * 864e5, 1],
    ])
      db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        shop,
        status,
        1,
        1,
        0,
        300,
        created,
        created,
        deleted,
      );
    db.close();
    for (const id of [expired, active, orphan])
      await writeFile(data + "/files/" + id + ".pdf", "%PDF-fixture");
    async function start() {
      const child = spawn(globalThis.process.execPath, ["server.mjs"], {
        cwd: new URL("..", import.meta.url),
        env: { ...globalThis.process.env, PORT: "0", QRBD_DATA_DIR: data },
        stdio: ["ignore", "pipe", "pipe"],
      });
      process = child;
      let stderr = "";
      child.stderr.on("data", (b) => (stderr += b));
      const port = await new Promise((resolve, reject) => {
        child.stdout.on("data", (b) => {
          const m = b.toString().match(/0.0.0.0:(\d+)/);
          if (m) resolve(m[1]);
        });
        child.on("exit", () => reject(Error(stderr)));
        setTimeout(() => reject(Error("Startup timeout")), 10000).unref();
      });
      return "http://127.0.0.1:" + port;
    }
    async function stop() {
      const current = process;
      process = null;
      current.kill("SIGTERM");
      await once(current, "exit");
    }
    let base = await start();
    const account = await fetch(base + "/api/me", {
      headers: { cookie: "qrbd_session=" + token },
    });
    assert.equal(account.status, 200);
    assert.equal((await account.json()).name, "Existing Shop");
    assert.equal(
      (await (await fetch(base + "/api/receipt/" + expired)).json()).status,
      "expired",
    );
    assert.equal(
      (await (await fetch(base + "/api/receipt/" + active)).json()).status,
      "queued",
    );
    assert.equal((await fetch(base + "/api/receipt/" + old)).status, 404);
    assert.deepEqual(await readdir(data + "/files"), [active + ".pdf"]);
    const backups = await readdir(data + "/schema-backups");
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(data + "/schema-backups/" + backups[0]);
    assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM shops").get().n, 1);
    assert.equal(
      backup
        .prepare("PRAGMA table_info(shops)")
        .all()
        .some((c) => c.name === "duplex_enabled"),
      false,
    );
    backup.close();
    await stop();
    const updated = new DatabaseSync(filename);
    updated
      .prepare(
        "UPDATE jobs SET status='printing',device='device-fixture',updated=? WHERE id=?",
      )
      .run(now - 20 * 60e3, active);
    updated.close();
    base = await start();
    const recovery = await (
      await fetch(base + "/api/receipt/" + active)
    ).json();
    assert.equal(
      recovery.status,
      "attention",
      "ambiguous print becomes attention, never automatically queued",
    );
    assert.equal(recovery.deleted, false);
    assert.equal(
      (await readdir(data + "/schema-backups")).length,
      1,
      "migration is idempotent",
    );
    await stop();
    await rm(data + "/files/" + active + ".pdf");
    base = await start();
    const lost = await (await fetch(base + "/api/receipt/" + active)).json();
    assert.equal(lost.status, "file_lost");
    assert.equal(lost.deleted, true);

    await stop();
  } finally {
    if (process) {
      process.kill("SIGTERM");
      await once(process, "exit");
    }
    await rm(data, { recursive: true, force: true });
  }
});
