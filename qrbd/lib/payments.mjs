import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function protect(secret, key) {
  const k = Buffer.from(key || "", "base64");
  if (k.length !== 32)
    throw Object.assign(
      new Error("Server QRBD_SECRET_KEY (32-byte base64) configure করুন।"),
      { status: 503 },
    );
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", k, iv),
    body = Buffer.concat([c.update(JSON.stringify(secret), "utf8"), c.final()]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    body: body.toString("base64"),
  });
}
export function unprotect(value, key) {
  const k = Buffer.from(key || "", "base64"),
    v = JSON.parse(value),
    d = createDecipheriv("aes-256-gcm", k, Buffer.from(v.iv, "base64"));
  d.setAuthTag(Buffer.from(v.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(v.body, "base64")),
      d.final(),
    ]).toString(),
  );
}
export function validPayment(record, job, transaction, store) {
  return (
    String(record.pay_status) === "Successful" &&
    String(record.status_code) === "2" &&
    String(record.mer_txnid) === transaction &&
    String(record.store_id) === store &&
    String(record.currency) === "BDT" &&
    /^\d+(?:\.\d{1,2})?$/.test(String(record.amount)) &&
    Math.round(Number(record.amount) * 100) === job.amount
  );
}
export class AamarPay {
  constructor({ store, signature, mode = "sandbox", fetcher = fetch, base }) {
    this.store = store;
    this.signature = signature;
    this.base =
      base ||
      (mode === "live"
        ? "https://secure.aamarpay.com"
        : "https://sandbox.aamarpay.com");
    this.fetcher = fetcher;
  }
  async request(url, init) {
    const r = await this.fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok) throw Error("Payment provider unavailable");
    const parts = [];
    let length = 0;
    for await (const chunk of r.body) {
      length += chunk.length;
      if (length > 256000) throw Error("Provider response too large");
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString());
  }
  async checkout({ transaction, amount, customer, callback }) {
    const result = await this.request(this.base + "/jsonpost.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: this.store,
        signature_key: this.signature,
        tran_id: transaction,
        success_url: callback,
        fail_url: callback,
        cancel_url: callback,
        amount: (amount / 100).toFixed(2),
        currency: "BDT",
        desc: "QRBD print order",
        cus_name: customer.name,
        cus_email: customer.email,
        cus_phone: customer.phone,
        type: "json",
      }),
    });
    if (String(result.result) !== "true")
      throw Error("Payment checkout rejected");
    const url = new URL(result.payment_url);
    if (
      url.protocol !== "https:" ||
      !["sandbox.aamarpay.com", "secure.aamarpay.com"].includes(url.hostname)
    )
      throw Error("Unexpected checkout destination");
    return url.href;
  }
  async verify(transaction) {
    const u = new URL(this.base + "/api/v1/trxcheck/request.php");
    u.search = new URLSearchParams({
      request_id: transaction,
      store_id: this.store,
      signature_key: this.signature,
      type: "json",
    }).toString();
    return this.request(u.href);
  }
}
