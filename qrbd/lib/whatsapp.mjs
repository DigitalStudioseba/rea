import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mergeDocuments, printOptions } from "./documents.mjs";
export function verifySignature(body, header, secret) {
  if (!secret || !/^sha256=[0-9a-f]{64}$/.test(header || "")) return false;
  const expected = createHmac("sha256", secret).update(body).digest(),
    actual = Buffer.from(header.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function captionOptions(caption = "") {
  const tokens = String(caption)
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    options = { color: "bw", copies: 1, duplex: "off" },
    seen = new Set();
  for (const token of tokens) {
    let key, value;
    if (["bw", "color"].includes(token)) {
      key = "color";
      value = token;
    } else if (/^copies=(?:[1-9]|1[0-9]|20)$/.test(token)) {
      key = "copies";
      value = token.slice(7);
    } else if (/^duplex=(?:off|long|short)$/.test(token)) {
      key = "duplex";
      value = token.slice(7);
    } else throw Error("Caption: bw/color copies=1 duplex=off/long/short");
    if (seen.has(key)) throw Error("Duplicate caption option");
    seen.add(key);
    options[key] = value;
  }
  return printOptions(options);
}
async function bounded(response, max) {
  if (!response.ok) throw Error("WhatsApp provider request failed");
  if (Number(response.headers.get("content-length")) > max)
    throw Error("Media too large");
  const parts = [];
  let length = 0;
  for await (const b of response.body) {
    length += b.length;
    if (length > max) throw Error("Media too large");
    parts.push(b);
  }
  return Buffer.concat(parts);
}
export function installWhatsApp({ app, db, error, wrap, createJob, findShop }) {
  const env = process.env,
    configured = () =>
      !!(
        env.WA_APP_SECRET &&
        env.WA_VERIFY_TOKEN &&
        env.WA_ACCESS_TOKEN &&
        env.WA_PHONE_NUMBER_ID &&
        env.WA_SHOP_ID
      );
  app.get("/integrations/whatsapp", (req, res) => {
    if (!configured()) return res.sendStatus(503);
    if (
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === env.WA_VERIFY_TOKEN
    )
      return res
        .type("text")
        .send(String(req.query["hub.challenge"] || "").slice(0, 100));
    res.sendStatus(403);
  });
  const graph = () =>
    `https://graph.facebook.com/${env.WA_GRAPH_VERSION || "v22.0"}`;
  async function graphJSON(endpoint, body) {
    const r = await fetch(graph() + endpoint, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + env.WA_ACCESS_TOKEN,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    return JSON.parse((await bounded(r, 256000)).toString());
  }
  const send = (to, text) =>
    graphJSON("/" + env.WA_PHONE_NUMBER_ID + "/messages", {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    });
  async function processMessage(m) {
    try {
      if (!["document", "image"].includes(m.type)) {
        await send(
          m.from,
          "QRBD: PDF/JPG/PNG পাঠান। Caption: bw copies=1 duplex=off (অথবা color, duplex=long/short)। কাউন্টারে টাকা অথবা receipt link-এ online payment; টাকা নিশ্চিত না হলে print হবে না।",
        );
        db.prepare(
          "UPDATE whatsapp_messages SET status='processed' WHERE id=?",
        ).run(m.id);
        return;
      }
      const s = findShop(env.WA_SHOP_ID);
      if (!s.is_open) throw Error("Shop closed");
      const media = m[m.type];
      if (!/^[0-9]{1,40}$/.test(media.id || ""))
        throw Error("Invalid media ID");
      const options = captionOptions(media.caption);
      if (options.duplex !== "off" && !s.duplex_enabled)
        throw Error("Duplex is disabled");
      const info = await graphJSON("/" + media.id);
      const url = new URL(info.url);
      if (
        url.protocol !== "https:" ||
        !["lookaside.fbsbx.com", "graph.facebook.com"].includes(url.hostname) ||
        url.username ||
        url.password ||
        Number(info.file_size) > 10 * 1024 * 1024
      )
        throw Error("Unsupported media URL or size");
      const r = await fetch(url, {
          headers: { Authorization: "Bearer " + env.WA_ACCESS_TOKEN },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        }),
        buffer = await bounded(r, 10 * 1024 * 1024),
        document = await mergeDocuments([{ buffer }]);
      const current = findShop(s.id);
      if (
        !current.is_open ||
        current.bw !== s.bw ||
        current.color !== s.color ||
        current.duplex_enabled !== s.duplex_enabled
      )
        throw Error("Shop settings changed; resend");
      const job = createJob(current, document, {
        ...options,
        kind: "document",
        source: "whatsapp",
      });
      db.prepare(
        "UPDATE whatsapp_messages SET status='processed',job=? WHERE id=?",
      ).run(job.id, m.id);
      await send(
        m.from,
        `QRBD order #${job.id.slice(-8).toUpperCase()} · ৳${(job.amount / 100).toFixed(2)}\n${env.QRBD_PUBLIC_URL}/shop/${s.id}?receipt=${job.id}\nকাউন্টারে টাকা দিন অথবা receipt-এ configured online payment বেছে নিন।`,
      );
    } catch {
      // Do not replay ambiguous messages automatically; this prevents duplicate physical orders.
      db.prepare(
        "UPDATE whatsapp_messages SET status=CASE WHEN job IS NULL THEN 'failed' ELSE 'reply_failed' END WHERE id=?",
      ).run(m.id);
      try {
        await send(
          m.from,
          "QRBD: ফাইল বা reply প্রক্রিয়াকরণে সমস্যা। একই file বারবার পাঠাবেন না; দোকানদারের সঙ্গে যোগাযোগ করুন।",
        );
      } catch {}
    }
  }
  // A bounded worker queue; raw message/phone data is retained only in memory while handling.
  let active = 0;
  const queue = [];
  function drain() {
    while (active < 2 && queue.length) {
      const m = queue.shift();
      active++;
      processMessage(m).finally(() => {
        active--;
        drain();
      });
    }
  }
  app.post(
    "/integrations/whatsapp",
    express.raw({ type: "application/json", limit: "256kb" }),
    wrap(async (req, res) => {
      if (!configured()) return res.sendStatus(503);
      if (
        !Buffer.isBuffer(req.body) ||
        !verifySignature(
          req.body,
          req.get("x-hub-signature-256"),
          env.WA_APP_SECRET,
        )
      )
        return res.sendStatus(403);
      let body;
      try {
        body = JSON.parse(req.body);
      } catch {
        throw error("Invalid webhook JSON");
      }
      if (body.object !== "whatsapp_business_account")
        return res.sendStatus(400);
      const messages = [];
      for (const e of Array.isArray(body.entry) ? body.entry : [])
        for (const change of Array.isArray(e.changes) ? e.changes : [])
          if (
            change.value?.metadata?.phone_number_id === env.WA_PHONE_NUMBER_ID
          )
            for (const m of Array.isArray(change.value.messages)
              ? change.value.messages
              : [])
              if (
                typeof m.id === "string" &&
                m.id.length < 300 &&
                /^\d{8,16}$/.test(m.from || "")
              )
                messages.push(m);
      if (messages.length + queue.length > 30) return res.sendStatus(503);
      for (const m of messages) {
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO whatsapp_messages(id,created,status) VALUES(?,?,'accepted')",
          )
          .run(m.id, Date.now());
        if (inserted.changes) queue.push(m);
      }
      res.sendStatus(200);
      drain();
    }),
  );
  // Retain only message IDs/status for dedupe, not phone numbers or message bodies.
  db.prepare("DELETE FROM whatsapp_messages WHERE created<?").run(
    Date.now() - 30 * 864e5,
  );
}
