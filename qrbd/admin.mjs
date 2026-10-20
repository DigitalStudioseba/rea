// Local server operator tool: records a payout that was independently performed.
// It never initiates a bank/mobile-money transfer.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const filename = path.join(
  path.resolve(process.env.QRBD_DATA_DIR || path.join(root, ".data")),
  "qrbd.sqlite",
);
if (!fs.existsSync(filename))
  throw Error("Database missing; check QRBD_DATA_DIR");
const db = new DatabaseSync(filename);
db.exec("PRAGMA busy_timeout=5000");
try {
  const [command, id, reference, confirmation] = process.argv.slice(2);
  if (command === "withdrawals") {
    console.table(
      db
        .prepare(
          "SELECT id,shop,amount/100.0 AS taka,destination,status,reference,created FROM withdrawals WHERE status='requested' ORDER BY created",
        )
        .all(),
    );
  } else if (["mark-paid", "reject"].includes(command)) {
    if (
      !/^[a-f0-9]{24}$/.test(id || "") ||
      !reference ||
      reference.length < 5 ||
      reference.length > 150
    )
      throw Error(
        "Supply withdrawal ID and a real external payout reference or rejection reason (5–150 chars).",
      );
    if (
      command === "mark-paid" &&
      confirmation !== "--confirm-external-payment"
    )
      throw Error(
        "First verify actual payout externally, then use --confirm-external-payment. No money is transferred by this tool.",
      );
    db.exec("BEGIN IMMEDIATE");
    const changed = db
      .prepare(
        "UPDATE withdrawals SET status=?,reference=? WHERE id=? AND status='requested'",
      )
      .run(command === "mark-paid" ? "paid" : "rejected", reference, id);
    if (!changed.changes) {
      db.exec("ROLLBACK");
      throw Error("Withdrawal missing or already finalized");
    }
    db.exec("COMMIT");
    console.log("Recorded only. No funds transferred.");
  } else {
    console.log(
      'Usage:\n  node admin.mjs withdrawals\n  node admin.mjs mark-paid <id> <external-reference> --confirm-external-payment\n  node admin.mjs reject <id> "<reason>"',
    );
    process.exitCode = 1;
  }
} finally {
  db.close();
}
