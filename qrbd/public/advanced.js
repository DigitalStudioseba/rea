const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "৳" + Number(n).toLocaleString("bn-BD", { maximumFractionDigits: 2 });
async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      "x-qrbd-request": "1",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
  });
  let value;
  try {
    value = await r.json();
  } catch {
    throw Error("সার্ভারের উত্তর পড়া যায়নি।");
  }
  if (!r.ok) throw Error(value.error || "অনুরোধ সম্পন্ন হয়নি।");
  return value;
}
const json = (method, value) => ({ method, body: JSON.stringify(value) });
function notice(node, text) {
  node.textContent = text;
}
function attachForm(root, selector, handler) {
  const form = root.querySelector(selector);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const error = form.querySelector(".form-error");
    try {
      await handler(form);
      if (error) error.textContent = "সংরক্ষিত হয়েছে।";
    } catch (err) {
      if (error) error.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}
export async function mountDashboard(me) {
  const [config, devices, referral, history] = await Promise.all([
    api("/api/features"),
    api("/api/devices"),
    api("/api/referrals"),
    api("/api/payment-history"),
  ]);
  const panel = document.createElement("section");
  panel.className = "advanced-section";
  document.querySelector(".page").append(panel);
  const referralLink = location.origin + "/?ref=" + me.id;
  panel.innerHTML = `<div class="section-heading" id="advanced"><div><div class="eyebrow">QRBD / EXTENDED TOOLKIT</div><h2>প্রিন্ট, পেমেন্ট ও ব্যবসা।</h2></div><a class="btn outline small" href="/tools/${escape(me.id)}" target="_blank" rel="noopener">Photo ও Resume tools ↗</a></div><div class="feature-columns"><div>
 <section class="panel"><h2>Printer routing ও duplex</h2><p class="sub">Windows printer-এর exact নাম দিন। Native Android companion system print dialog ব্যবহার করে।</p><form id="route-form">${[
   ["bw", "B&W printer"],
   ["color", "Color printer"],
   ["duplex", "Duplex printer"],
   ["photo", "Photo printer"],
 ]
   .map(
     ([k, l]) =>
       `<label>${l}<input name="${k}" maxlength="150" value="${escape(config.routing[k])}" placeholder="Windows-এ যে printer name দেখায়"></label>`,
   )
   .join(
     "",
   )}<label><input name="duplexEnabled" type="checkbox" ${config.duplex ? "checked" : ""}>ডুপ্লেক্স চালু (printer-এ সমর্থিত হতে হবে)</label><div class="two"><label>Photo sheet / ৳<input name="photoRate" type="number" min="1" max="10000" step=".01" value="${config.photoRate}" required></label><label>Resume / ৳<input name="resumeRate" type="number" min="1" max="10000" step=".01" value="${config.resumeRate}" required></label></div><p class="form-error" role="status"></p><button class="btn small">সংরক্ষণ করুন</button></form></section>
 <section class="panel"><h2>Windows / Android device</h2><p class="sub">একটি shop-এ একটিই enabled token। নতুন token নিলে আগের device revoke হবে। Agent শুধু payment-confirmed order নেয়।</p><div>${devices.length ? devices.map((d) => `<p class="sub">${escape(d.name)} · ${d.enabled ? "Enabled" : "Revoked"} · ${d.last_seen ? escape(new Date(d.last_seen).toLocaleString()) : "Not connected"} ${d.enabled ? `<button class="btn small outline danger" data-revoke="${escape(d.id)}">Revoke</button>` : ""}</p>`).join("") : "কোনো device নেই।"}</div><form id="device-form"><label>Device-এর নাম<input name="name" required minlength="2" maxlength="60" placeholder="যেমন: Counter Windows PC"></label><button class="btn small">নতুন device token নিন</button><p class="form-error"></p></form><div id="device-token" hidden><p class="note">এই secret token শুধু একবার দেখানো হচ্ছে। কারও সঙ্গে শেয়ার করবেন না। Refresh করলে আর দেখা যাবে না।</p><textarea id="new-token" readonly aria-label="নতুন device secret token" autocomplete="off"></textarea></div><p><a class="btn small outline" href="/downloads/windows-agent.py" download>↓ Windows agent (Python)</a></p><details><summary>Windows agent setup</summary><p class="sub">Python 3.10+ ও নিজের যাচাইকৃত SumatraPDF.exe install করুন। Device token environment variable-এ দিন; code বা screenshot-এ প্রকাশ করবেন না।</p><pre class="code">$env:QRBD_AGENT_TOKEN="YOUR_PRIVATE_TOKEN"
python qrbd-windows-agent.py --url ${escape(location.origin)} --sumatra "C:\\Tools\\SumatraPDF.exe" --sha256 YOUR_VERIFIED_EXE_SHA256 --enable-printing</pre><p class="fine">HTTPS origin প্রয়োজন। Agent spool submission জানায়, physical completion নয়। কাগজ দেখে dashboard-এ completion করুন। Ambiguous print স্বয়ংক্রিয়ভাবে retry হয় না।</p></details><p class="fine">Android native app source: qrbd/android/। APK এই sandbox-এ build করা হয়নি। Compatible Android print service ও system print dialog প্রয়োজন; universal silent OTG নয়।</p></section>
 <section class="panel"><h2>WhatsApp Business printing</h2><span class="badge ${config.whatsapp.configured ? "" : "amber"}">${config.whatsapp.configured ? "Server credentials configured" : "Operator setup প্রয়োজন"}</span><p class="sub">Official Meta Cloud API integration। Webhook signature যাচাই করে PDF/JPG/PNG থেকে unpaid order তৈরি হয়। Payment নিশ্চিত না হওয়া পর্যন্ত print হয় না।</p><p class="sub">Caption: <code>color copies=2 duplex=long</code><br>Default: <code>bw copies=1 duplex=off</code></p><p class="fine">Server-এ WA_APP_SECRET, WA_VERIFY_TOKEN, WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_SHOP_ID configure করুন। Callback: <span class="mono">${escape(location.origin)}/integrations/whatsapp</span>। Meta approval, network access ও real-number test এখনো প্রয়োজন।</p></section></div><div>
 <section class="panel"><h2>Online payment · aamarPay</h2><p class="sub">${config.gateway.configured ? `Configured: ${escape(config.gateway.store)} · ${escape(config.gateway.mode)}` : "Gateway configure করা নেই।"}<br>Secret server-side AES-GCM encrypted থাকে। HTTPS public URL ও operator encryption key প্রয়োজন।</p><form id="gateway-form"><label>Mode<select name="mode"><option value="sandbox">Sandbox — real money নয়</option><option value="live" ${config.gateway.mode === "live" ? "selected" : ""}>LIVE — real customer payment</option></select></label><label>Store ID<input name="store" required maxlength="100" value="${escape(config.gateway.store || "")}" autocomplete="off"></label><label>Signature key<input name="signature" type="password" required minlength="5" maxlength="200" autocomplete="new-password"></label><p class="form-error"></p><button class="btn small">Gateway সংরক্ষণ</button> <button type="button" class="btn small outline" id="remove-gateway">বন্ধ করুন</button></form><p class="fine">Sandbox success print release করে না। Browser redirect-কে payment proof ধরা হয় না; server provider-এর transaction API থেকে amount/currency/store/ID যাচাই করে।</p></section>
 <section class="panel"><h2>Referral programme</h2><p class="sub">${escape(referral.policy)}</p><label>আপনার referral link<input value="${escape(referralLink)}" readonly></label><div class="two"><div class="stat"><small>মোট অর্জিত</small><strong>${money(referral.earned)}</strong></div><div class="stat"><small>উত্তোলনযোগ্য</small><strong>${money(referral.available)}</strong></div></div><p class="fine">Referral code দিয়ে register করলে tracking হয়। কেবল platform-এর real paid activation-এ reward। নিজের shop ID referral দিয়ে নিজেকে credit করা যায় না।</p>${referral.shops.map((s) => `<p class="sub">${escape(s.name)} · ${s.earned ? "Earned " + money(s.reward) : "Activation অপেক্ষমাণ"}</p>`).join("") || '<p class="sub">এখনো কোনো referred shop নেই।</p>'}<form id="withdraw-form"><label>Amount / ৳<input name="amount" type="number" min="500" max="${Math.max(500, referral.available)}" required></label><label>bKash/Nagad payout mobile<input name="destination" required pattern="[+0-9]{11,15}" autocomplete="off"></label><p class="form-error"></p><button class="btn small" ${referral.available < 500 ? "disabled" : ""}>Withdrawal request</button></form><p class="fine">এটি request, automatic transfer নয়। Operator actual payout reference ছাড়া paid mark করবেন না।</p>${referral.withdrawals.map((w) => `<p class="sub">${money(w.amount)} · ${escape(w.status)} ${w.reference ? escape(w.reference) : ""}</p>`).join("")}</section>
 <section class="panel"><h2>Shop activation</h2><p class="sub">${config.activated ? "দোকানের live activation সম্পন্ন।" : config.platformBilling ? `এককালীন platform activation ${money(config.activationPrice)}। Referral reward এই fee থেকে funded।` : "Platform billing configure করা নেই। Preview features চালু আছে; কোনো fake activation বা commission credit হয় না।"}</p>${config.platformBilling && !config.activated ? `<form id="activation-form"><label>আপনার নাম<input name="name" required maxlength="80"></label><label>Email<input type="email" name="email" value="${escape(me.email)}" required></label><label>Phone<input name="phone" required pattern="[+0-9]{8,16}"></label><button class="btn small">Activation checkout ↗</button><p class="form-error"></p></form><button id="verify-activation" class="btn small outline">Payment verify করুন</button><p id="activation-status" class="sub"></p>` : ""}</section>
 <section class="panel"><h2>সাম্প্রতিক payment attempts</h2><p class="fine">Manual counter payments এই তালিকায় নয়। Late payment হলে automatic print নয়—refund/reconcile প্রয়োজন।</p>${history.map((p) => `<p class="sub"><code>${escape(p.id.slice(-8))}</code> · ${escape(p.kind)} · ${money(p.amount)} · ${escape(p.mode)} · ${escape(p.status)}</p>`).join("") || '<p class="sub">কোনো online attempt নেই।</p>'}</section></div></div>`;
  attachForm(panel, "#route-form", async (f) => {
    const v = Object.fromEntries(new FormData(f)),
      routing = {};
    for (const k of ["bw", "color", "duplex", "photo"]) routing[k] = v[k];
    await api(
      "/api/features",
      json("PATCH", {
        routing,
        duplex: f.elements.duplexEnabled.checked,
        photoRate: Number(v.photoRate),
        resumeRate: Number(v.resumeRate),
      }),
    );
  });
  attachForm(panel, "#device-form", async (f) => {
    if (!confirm("পুরোনো token revoke করে নতুন token তৈরি করবেন?")) return;
    const r = await api(
      "/api/devices",
      json("POST", { name: f.elements.name.value }),
    );
    panel.querySelector("#new-token").value = r.token;
    panel.querySelector("#device-token").hidden = false;
  });
  panel.querySelectorAll("[data-revoke]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Device token revoke করবেন?")) return;
        try {
          await api("/api/devices/" + b.dataset.revoke, { method: "DELETE" });
          b.textContent = "Revoked";
          b.disabled = true;
        } catch (e) {
          alert(e.message);
        }
      }),
  );
  attachForm(panel, "#gateway-form", async (f) => {
    await api("/api/gateway", json("PUT", Object.fromEntries(new FormData(f))));
    f.elements.signature.value = "";
  });
  panel.querySelector("#remove-gateway").onclick = async () => {
    try {
      await api("/api/gateway", { method: "DELETE" });
      alert(
        "Online payment disabled. Existing transactions may still need verification.",
      );
    } catch (e) {
      alert(e.message);
    }
  };
  attachForm(panel, "#withdraw-form", async (f) => {
    await api(
      "/api/withdrawals",
      json("POST", Object.fromEntries(new FormData(f))),
    );
    f.reset();
    alert(
      "Request পাঠানো হয়েছে; কোনো টাকা এখনো transfer হয়নি। Refresh করে balance দেখুন।",
    );
  });
  if (panel.querySelector("#activation-form")) {
    attachForm(panel, "#activation-form", async (f) => {
      const p = await api(
        "/api/billing/checkout",
        json("POST", Object.fromEntries(new FormData(f))),
      );
      location.assign(p.url);
    });
    panel.querySelector("#verify-activation").onclick = async () => {
      try {
        const r = await api("/api/billing/verify", json("POST", {}));
        notice(
          panel.querySelector("#activation-status"),
          r.paid
            ? r.mode === "sandbox"
              ? "Sandbox test verified; real activation নয়।"
              : "Activation verified. Refresh করুন।"
            : "Payment এখনো verified নয়।",
        );
      } catch (e) {
        notice(panel.querySelector("#activation-status"), e.message);
      }
    };
  }
}
export async function mountReceipt(r) {
  const node = document.querySelector("#online-payment");
  if (!node || r.status !== "pending") return;
  const shop = await api("/api/shops/" + r.shop);
  if (!shop.online) return;
  node.innerHTML = `<details><summary>অনলাইনে payment করুন · aamarPay</summary><p class="fine">Sandbox হলে কোনো টাকা বা print release নয়। Checkout-এ mode দেখে এগোন। Provider-এ আপনার নাম/email/phone যাবে।</p><form id="online-form"><label>নাম<input name="name" required maxlength="80"></label><label>Email<input type="email" name="email" required></label><label>Phone<input name="phone" required pattern="[+0-9]{8,16}"></label><button class="btn small">Secure checkout ↗</button><p class="form-error"></p></form></details><button class="btn small outline" id="verify-payment">আগে payment করেছেন? Verify করুন</button><p id="payment-status" class="sub"></p>`;
  attachForm(node, "#online-form", async (f) => {
    const p = await api(
      "/api/receipt/" + r.id + "/checkout",
      json("POST", Object.fromEntries(new FormData(f))),
    );
    location.assign(p.url);
  });
  node.querySelector("#verify-payment").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const result = await api(
        "/api/receipt/" + r.id + "/verify",
        json("POST", {}),
      );
      notice(
        node.querySelector("#payment-status"),
        result.late
          ? "Payment late এসেছে। Shop-এর সঙ্গে refund/reconcile করুন।"
          : result.paid
            ? result.mode === "sandbox"
              ? "Sandbox verified — real payment নয়, print release হয়নি।"
              : "Payment verified. Order status আপডেট হবে।"
            : "Payment verified হয়নি। আবার টাকা না দিয়ে পরে verify করুন।",
      );
    } catch (err) {
      notice(node.querySelector("#payment-status"), err.message);
    } finally {
      e.target.disabled = false;
    }
  };
}
export async function tools(shopId) {
  const shop = await api("/api/shops/" + shopId),
    app = document.querySelector("#app");
  app.innerHTML = `<section class="page"><div class="page-top"><div><div class="eyebrow">QRBD / CREATIVE PRINT TOOLS</div><h1>${escape(shop.name)}</h1><p>ছবির sheet অথবা English resume বানিয়ে প্রিন্ট অর্ডার দিন।</p></div><a class="btn outline small" href="/shop/${escape(shopId)}">ডকুমেন্ট প্রিন্ট ↗</a></div><div class="feature-columns"><section class="panel"><h2>Photo sheet</h2><p class="sub">ছবি stretch না করে grid-এ fit করা হয়। Border cutting guide আছে। Passport specification certified নয়।</p><form id="photo-form"><label>JPG/PNG ছবি<input type="file" name="photo" accept="image/jpeg,image/png" required></label><div class="two"><label>কত ছবি?<select name="count">${[4, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Paper size<select name="size"><option value="4x6">4×6 inches</option><option value="a4">A4</option></select></label></div><label>Copies<input name="copies" type="number" min="1" max="20" value="1" required></label><p class="note">প্রতি sheet ${money(shop.photoRate)} × copies। Paper size printer dialog-এ মিলিয়ে নিন।</p><label><input name="consent" value="yes" type="checkbox" required>ছবি প্রক্রিয়াকরণ ও print-এর জন্য সম্মত।</label><button class="btn" ${shop.isOpen ? "" : "disabled"}>Photo sheet অর্ডার করুন ↗</button><p class="form-error"></p></form></section><section class="panel"><h2>Resume maker</h2><p class="sub">৩টি text template। বর্তমানে English characters only। বাংলা PDF font shaping ভবিষ্যৎ কাজ।</p><form id="resume-form"><label>Template<select name="template"><option value="classic">Classic</option><option value="modern">Modern green</option><option value="compact">Compact</option></select></label>${[
    ["name", "Full name", 80],
    ["title", "Professional title", 100],
    ["email", "Email", 120],
    ["phone", "Phone", 40],
  ]
    .map(
      ([k, l, max]) =>
        `<label>${l}<input name="${k}" maxlength="${max}" ${k === "name" ? "required" : ""}></label>`,
    )
    .join("")}${[
    ["summary", "Profile summary", 900],
    ["experience", "Work experience", 2000],
    ["education", "Education", 1000],
    ["skills", "Skills", 600],
  ]
    .map(
      ([k, l, max]) =>
        `<label>${l}<textarea name="${k}" maxlength="${max}"></textarea></label>`,
    )
    .join(
      "",
    )}<div class="two"><label>Print mode<select name="color"><option value="bw">B&W</option><option value="color">Color</option></select></label><label>Copies<input name="copies" type="number" min="1" max="20" value="1" required></label></div><p class="note">প্রতি resume ${money(shop.resumeRate)} × copies। Template একাধিক page-ও হতে পারে।</p><label><input type="checkbox" name="consent" value="yes" required>তথ্য প্রক্রিয়াকরণ ও print-এর জন্য সম্মত।</label><button class="btn" ${shop.isOpen ? "" : "disabled"}>Resume অর্ডার করুন ↗</button><p class="form-error"></p></form></section></div></section>`;
  attachForm(app, "#photo-form", async (f) => {
    const r = await api("/api/shops/" + shopId + "/photo", {
      method: "POST",
      body: new FormData(f),
    });
    location.assign("/shop/" + shopId + "?receipt=" + r.id);
  });
  attachForm(app, "#resume-form", async (f) => {
    const r = await api(
      "/api/shops/" + shopId + "/resume",
      json("POST", Object.fromEntries(new FormData(f))),
    );
    location.assign("/shop/" + shopId + "?receipt=" + r.id);
  });
}
