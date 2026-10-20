import { chromium as pw } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
const data = await mkdtemp(tmpdir() + "/qrbd-browser-");
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: "0", QRBD_DATA_DIR: data },
});
const port = await new Promise((resolve, reject) => {
  server.stdout.on("data", (b) => {
    const m = b.toString().match(/0.0.0.0:(\d+)/);
    if (m) resolve(m[1]);
  });
  server.on("error", reject);
});
let browser;
try {
  browser = await pw.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    args: JSON.parse(process.env.BROWSER_ARGS || "[]"),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://127.0.0.1:" + port);
  await page.getByRole("heading", { name: /স্ক্যান করুন/ }).waitFor();
  await page.screenshot({ path: data + "/home.png", fullPage: true });
  await page.locator("[data-register]").first().click();
  await page.locator("[name=name]").fill("QRBD Test Shop");
  await page.locator("[name=email]").fill("ui@example.com");
  await page.locator("[name=password]").fill("browser-test-pass");
  await page.locator("#auth-submit").click();
  await page.waitForURL("**/dashboard");
  await page.getByRole("heading", { name: "QRBD Test Shop" }).waitFor();
  await page
    .getByRole("heading", { name: "Printer routing ও duplex" })
    .waitFor();
  await page.locator("#route-form [name=bw]").fill("Office B&W");
  await page.locator("#route-form [name=color]").fill("Office Color");
  await page.locator("#route-form [name=duplex]").fill("Office Duplex");
  await page.locator("#route-form [name=photo]").fill("Office Photo");
  await page.locator("#route-form [name=duplexEnabled]").check();
  await page.locator("#route-form [name=photoRate]").fill("35");
  await page
    .locator("#route-form button[type=submit], #route-form button:not([type])")
    .click();
  await page
    .locator("#route-form .form-error")
    .filter({ hasText: "সংরক্ষিত হয়েছে।" })
    .waitFor();
  page.on("dialog", (d) => d.accept());
  await page.locator("#device-form [name=name]").fill("Browser test device");
  await page.locator("#device-form button").click();
  await page.locator("#device-token").waitFor({ state: "visible" });
  if ((await page.locator("#new-token").inputValue()).length !== 64)
    throw Error("Device token missing");
  const link = await page
    .getByRole("link", { name: "কাস্টমার পেজ" })
    .getAttribute("href");
  const customer = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await customer.goto(link);
  await customer.getByRole("heading", { name: "QRBD Test Shop" }).waitFor();
  await customer
    .locator("input[type=file]")
    .setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await customer.locator("[name=consent]").check();
  await customer.locator("#upload-form button[type=submit]").click();
  await customer.getByRole("heading", { name: "টাকার অপেক্ষায়" }).waitFor();
  await page.locator("#refresh").click();
  await page.getByRole("button", { name: "টাকা পেয়েছি" }).click();
  await page.getByRole("button", { name: "প্রিন্ট শুরু করুন" }).click();
  await page.getByRole("button", { name: "প্রিন্ট সম্পন্ন" }).click();
  await page.getByText("Server file মুছে দেওয়া হয়েছে").waitFor();
  await page.screenshot({ path: data + "/dashboard.png", fullPage: true });
  await customer.goto(link.replace("/shop/", "/tools/"));
  await customer
    .getByRole("heading", { name: "Photo sheet", exact: true })
    .waitFor();
  await customer
    .locator("#photo-form input[type=file]")
    .setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await customer.locator("#photo-form [name=copies]").fill("2");
  await customer.locator("#photo-form [name=consent]").check();
  await customer.locator("#photo-form button").click();
  await customer.getByRole("heading", { name: "টাকার অপেক্ষায়" }).waitFor();
  if (!(await customer.locator(".receipt").textContent()).includes("৳৭০"))
    throw Error("Photo price incorrect");
  await customer.goto(link.replace("/shop/", "/tools/"));
  await customer.locator("#resume-form [name=name]").fill("Example Person");
  await customer
    .locator("#resume-form [name=summary]")
    .fill("Experienced developer");
  await customer.locator("#resume-form [name=consent]").check();
  await customer.locator("#resume-form button").click();
  await customer.getByRole("heading", { name: "টাকার অপেক্ষায়" }).waitFor();
  await customer.goto(link);
  await customer.locator("[name=duplex]").selectOption("long");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Advanced dashboard mobile overflow");
  await customer.goto("http://127.0.0.1:" + port);
  await customer.getByRole("heading", { name: /স্ক্যান করুন/ }).waitFor();
  const overflow = await customer.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw Error("Mobile horizontal overflow");
  await customer.screenshot({ path: data + "/mobile.png", fullPage: true });
  const unexpected = errors.filter((e) => !e.includes("401"));
  if (unexpected.length) throw Error(unexpected.join("\n"));
  console.log(
    "PASS: desktop/mobile homepage, registration, dashboard, device enrollment, printer routing, duplex selection, photo sheet, resume orders, document lifecycle/deletion and no mobile overflow or unexpected console errors.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await once(server, "exit");
  await rm(data, { recursive: true, force: true });
}
