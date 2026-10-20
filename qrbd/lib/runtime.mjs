import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export function validEncryptionKey(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    Buffer.from(value, "base64").length === 32
  );
}
export function configureRuntime(env, data) {
  const production = env.NODE_ENV === "production";
  if (!env.QRBD_PUBLIC_URL && env.RENDER_EXTERNAL_URL)
    env.QRBD_PUBLIC_URL = env.RENDER_EXTERNAL_URL;
  if (production) {
    let url;
    try {
      url = new URL(env.QRBD_PUBLIC_URL);
    } catch {
      throw Error(
        "Production needs QRBD_PUBLIC_URL=https://your-domain (Render external URL is also supported)",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw Error("QRBD_PUBLIC_URL must be a bare HTTPS origin");
    if (env.QRBD_EMBED_PREVIEW === "1")
      throw Error("Iframe preview mode is forbidden in production");
    if (!env.QRBD_REGISTRATION_CODE && env.QRBD_OPEN_REGISTRATION !== "true")
      throw Error(
        "Set a private QRBD_REGISTRATION_CODE for the beta, or explicitly opt in to QRBD_OPEN_REGISTRATION=true after a security review",
      );
    if (env.QRBD_REGISTRATION_CODE && env.QRBD_REGISTRATION_CODE.length < 16)
      throw Error("Use a registration code of at least 16 characters");
    if (!env.QRBD_SECRET_KEY) {
      fs.mkdirSync(data, { recursive: true, mode: 0o700 });
      const filename = path.join(data, ".encryption-key");
      try {
        fs.writeFileSync(filename, randomBytes(32).toString("base64"), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const entry = fs.lstatSync(filename);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw Error("Encryption key must be a private regular file");
      env.QRBD_SECRET_KEY = fs.readFileSync(filename, "utf8").trim();
    }
  }
  if (env.QRBD_SECRET_KEY && !validEncryptionKey(env.QRBD_SECRET_KEY))
    throw Error(
      "QRBD_SECRET_KEY must be exactly 32 random bytes encoded as base64",
    );
  const hops = Number(env.QRBD_TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 3)
    throw Error(
      "QRBD_TRUST_PROXY_HOPS must be 0..3; use only your real proxy hop count",
    );
  return { production, proxyHops: hops };
}
