const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "৳" + Number(n).toLocaleString("bn-BD", { maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString("bn-BD");
let me = null,
  registerMode = false,
  refreshTimer,
  receiptTimer,
  receiptCache = "";
async function api(url, options = {}) {
  const headers = {
    "x-qrbd-request": "1",
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...options.headers,
  };
  const response = await fetch(url, { ...options, headers });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("সার্ভারের উত্তর পড়া যায়নি।");
  }
  if (!response.ok)
    throw Object.assign(new Error(result.error || "অনুরোধ সম্পন্ন হয়নি।"), {
      status: response.status,
    });
  return result;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  setTimeout(() => ($("#toast").hidden = true), 4500);
}
function auth(mode = false) {
  registerMode = mode;
  $("#register-fields").hidden = !mode;
  $("#auth-title").textContent = mode
    ? "আপনার দোকান, আরও স্মার্ট।"
    : "স্বাগতম আবার।";
  $("#auth-description").textContent = mode
    ? "বিনামূল্যে preview account খুলে শুরু করুন।"
    : "আপনার দোকানের অর্ডার ম্যানেজ করুন।";
  $("#auth-submit").textContent = mode ? "দোকান তৈরি করুন ↗" : "লগইন করুন ↗";
  $("#auth-toggle").textContent = mode
    ? "আগেই account আছে? লগইন করুন →"
    : "নতুন দোকান? নিবন্ধন করুন →";
  $("#auth-error").textContent = "";
  $("#auth-form").elements.password.minLength = mode ? 10 : 1;
  $("#auth-form").elements.password.autocomplete = mode
    ? "new-password"
    : "current-password";
  $("#auth").showModal();
}
$("#nav-account").onclick = () => (me ? location.assign("/dashboard") : auth());
$("#auth .close").onclick = () => $("#auth").close();
$("#auth-toggle").onclick = () => auth(!registerMode);
$("#auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = $("#auth-submit");
  b.disabled = true;
  $("#auth-error").textContent = "";
  try {
    const body = Object.fromEntries(new FormData(e.target));
    if (registerMode)
      body.referral = new URLSearchParams(location.search).get("ref") || "";
    await api(registerMode ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    location.assign("/dashboard");
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    b.disabled = false;
  }
};
function landing() {
  app.innerHTML = `
<section class="hero"><div><div class="pill"><span class="status-dot"></span> MADE FOR BANGLADESH · BUILD PREVIEW</div><h1>স্ক্যান করুন।<br>ফাইল পাঠান।<br><em>প্রিন্ট হয়ে যাক।</em></h1><p>WhatsApp-এর ভিড় নয়, পেনড্রাইভের ঝামেলাও নয়।<br>একটি QR-এ আপনার দোকানের প্রিন্টিং আরও সহজ।</p><div class="actions"><button class="btn" data-register>আপনার দোকান শুরু করুন <span>↗</span></button><a class="btn outline" href="#how">কীভাবে কাজ করে <span>↓</span></a></div><div class="trust"><span>✓ নিজের মূল্য, নিজের দোকান</span><span>✓ বাংলা ইন্টারফেস</span><span>✓ কোনো subscription charge নয়*</span></div></div>
<div class="hero-visual" aria-label="ফোন থেকে প্রিন্টারে ডকুমেন্ট পাঠানোর illustration"><div class="visual-label">ONE QR. LESS WORK.</div><div class="phone"><div class="notch"></div><div class="brand">QR<span>BD</span></div><div class="tiny">আপনার ডিজিটাল প্রিন্ট কাউন্টার</div><div class="upload-illustration">↥<br>ডকুমেন্ট আপলোড করুন</div><div class="file-card"><span>▤</span><div><b>class-notes.pdf</b><small>6 pages · Black & White</small></div><span>✓</span></div><div class="tiny">মোট মূল্য <b>৳১৮</b></div><div class="fake-button">অর্ডার পাঠান →</div></div><div class="printer"><div class="printer-top"></div><div class="printer-paper"><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div></div><div class="printer-light"></div><div class="printer-slot"></div><div class="printer-out"><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div></div></div><div class="float-card"><span class="check">✓</span><b>ছোট কাজ। বড় স্বস্তি।</b>Scan → Upload → Counter → Print</div><div class="visual-bottom">ILLUSTRATION · ACTUAL PRINTING IS MANUAL IN THIS PREVIEW</div></div></section>
<div class="strip"><span>▤ &nbsp;<b>PDF · JPG · PNG</b></span><span>▦ &nbsp;প্রতিটি দোকানের নিজস্ব QR</span><span>৳ &nbsp;বাংলাদেশি টাকায় মূল্য</span><span>♧ &nbsp;সময়মতো ফাইল পরিষ্কার</span></div>
<section class="section" id="how"><div class="section-heading"><div><div class="eyebrow">01 / সহজ প্রক্রিয়া</div><h2>তিন ধাপেই প্রিন্টের অর্ডার।</h2></div><p>কাস্টমারের ফোন থেকে আপনার দোকানের কাউন্টার। ফাইল আর অর্ডার থাকবে একই জায়গায়।</p></div><div class="grid3"><article class="card"><span class="step">STEP / 01</span><div class="icon-box">▦</div><h3>দোকানের QR স্ক্যান</h3><p>আপনার নিজস্ব QR প্রিন্ট করে দোকানে রাখুন। কাস্টমার ফোনেই খুলবেন দোকানের পেজ।</p></article><article class="card"><span class="step">STEP / 02</span><div class="icon-box">↥</div><h3>ফাইল ও প্রিন্ট বাছাই</h3><p>PDF বা ছবি আপলোড করুন। B&W/Color ও copies বেছে নিন; সার্ভার পাতা গুনে বিল তৈরি করবে।</p></article><article class="card"><span class="step">STEP / 03</span><div class="icon-box">▤</div><h3>কাউন্টারে টাকা, তারপর প্রিন্ট</h3><p>দোকানদার payment নিশ্চিত করে PDF খুলবেন এবং browser থেকে প্রিন্ট করবেন। Default manual printing; device agent configure করলে paid কাজ printer-এ পাঠানো যায়।</p></article></div></section>
<div class="green-section" id="features"><section class="section"><div class="section-heading"><div><div class="eyebrow">02 / আপনার শপ টুলকিট</div><h2>কম ক্লিক। গোছানো কাউন্টার।</h2></div><p>যে ফিচারগুলো এই সংস্করণে সত্যিই ব্যবহার করা যাবে—কোনো বানানো সংখ্যা বা fake payment নয়।</p></div><div class="feature-grid">${[
    [
      "▦",
      "নিজস্ব QR ও শেয়ার লিংক",
      "কোনো customer app install নয়। দোকানের লিংক থেকেই অর্ডার।",
    ],
    [
      "▧",
      "একসঙ্গে একাধিক ফাইল",
      "সর্বোচ্চ ৫টি PDF/JPG/PNG একটি print-ready PDF-এ।",
    ],
    [
      "৳",
      "নিজের rate নিজেই ঠিক করুন",
      "B&W ও Color-এর আলাদা মূল্য, copies-সহ নির্ভুল server-side bill।",
    ],
    [
      "≡",
      "লাইভ অর্ডার কাউন্টার",
      "অপেক্ষমাণ payment থেকে print completion—আলাদা status।",
    ],
    [
      "◷",
      "ফাইলের সীমিত মেয়াদ",
      "Unpaid ১ ঘণ্টা, অন্যান্য active job ২৪ ঘণ্টা; completed file সরিয়ে ফেলা হয়।",
    ],
    [
      "⚙",
      "দোকান খোলা বা বন্ধ",
      "নিজস্ব নোটিশ দিন। দোকান বন্ধ থাকলে নতুন অর্ডার নেওয়া হবে না।",
    ],
  ]
    .map(
      ([i, t, d]) =>
        `<article class="card"><div class="icon-box">${i}</div><h3>${t}</h3><p>${d}</p></article>`,
    )
    .join(
      "",
    )}</div><p class="fine">নতুন toolkit: Windows agent, configurable aamarPay, duplex routing, photo sheet, English resume ও referral tracking। Hardware/provider verification ছাড়া production-ready দাবি নয়।</p></section></div>
<section class="section"><div class="cta"><div><div class="eyebrow">YOUR NEXT SMART MOVE</div><h2>আপনার দোকানকে দিন<br>একটি স্মার্ট প্রিন্ট কাউন্টার।</h2><p>*Development preview ব্যবহার বিনামূল্যে। বাস্তব ব্যবসা চালুর আগে deployment ও printer testing প্রয়োজন।</p></div><button class="btn light" data-register>দোকান তৈরি করুন ↗</button></div></section>
<section class="section faq-grid" id="faq"><div><div class="eyebrow">03 / জেনে রাখুন</div><h2>প্রশ্ন আছে?<br>উত্তর এখানেই।</h2><p class="privacy">QRBD একটি স্বতন্ত্র implementation। QR Se Print-এর সঙ্গে যুক্ত নয় এবং তাদের ব্যক্তিগত কোড ব্যবহার করে না।</p></div><div><details open><summary>এখন কি অটোমেটিক প্রিন্ট হবে?</summary><p>দোকানদার device token ও printer routes সেট করে Windows agent চালালে paid order স্বয়ংক্রিয়ভাবে printer-এ পাঠানো হয়। বাস্তব hardware test প্রয়োজন। Browser থেকে manual print-ও করা যায়। Agent submission আর কাগজ বের হওয়া আলাদা—completion দোকানদার নিশ্চিত করেন।</p></details><details><summary>অনলাইন payment চালু আছে?</summary><p>Counter payment চালু আছে। দোকানদার aamarPay merchant credentials configure করলে checkout ও server-side transaction verification পাওয়া যাবে। Sandbox কখনো real payment বা real commission নয়। এই sandbox-এ provider test হয়নি।</p></details><details id="privacy"><summary>আমার ফাইল কতদিন থাকে?</summary><p>Completed, failed বা cancelled হলে server PDF মুছে দেওয়া হয়। Unpaid upload ১ ঘণ্টা পরে, অন্যান্য active file ২৪ ঘণ্টা পরে cleanup হয়; check প্রতি মিনিটে। Job record ৭ দিন পরে সরানো হয়। দোকানে download, browser ও printer spooler copy মুছতে দোকানদার দায়ী। এই prototype database-এ customer file backup তৈরি করা হয় না।</p></details><details><summary>সব printer-এ চলবে?</summary><p>Browser থেকে PDF প্রিন্ট করতে সক্ষম local printer দরকার। আপনার নিজের printer-এ test করুন। সব model-এর compatibility যাচাই করা হয়নি।</p></details></div></section>`;
  document
    .querySelectorAll("[data-register]")
    .forEach((b) => (b.onclick = () => auth(true)));
}
const labels = {
  pending: "টাকার অপেক্ষায়",
  queued: "প্রিন্টের জন্য প্রস্তুত",
  printing: "প্রিন্ট চলছে",
  completed: "সম্পন্ন",
  cancelled: "বাতিল",
  failed: "ব্যর্থ",
  expired: "মেয়াদ শেষ",
  file_lost: "ফাইল আর নেই — দোকানে যোগাযোগ করুন",
  submitted: "Printer-এ পাঠানো হয়েছে",
  attention: "Operator review প্রয়োজন",
};
function jobHTML(j) {
  const choices = {
    pending: [
      ["queued", "টাকা পেয়েছি ✓"],
      ["cancelled", "বাতিল"],
    ],
    queued: [
      ["printing", "প্রিন্ট শুরু করুন"],
      ["cancelled", "বাতিল"],
    ],
    printing: [
      ["completed", "প্রিন্ট সম্পন্ন ✓"],
      ["failed", "প্রিন্ট ব্যর্থ"],
    ],
    submitted: [
      ["completed", "প্রিন্ট সম্পন্ন ✓"],
      ["failed", "প্রিন্ট ব্যর্থ"],
    ],
    attention: [
      ["completed", "কাগজ পেয়েছি ✓"],
      ["failed", "প্রিন্ট হয়নি / বন্ধ করুন"],
    ],
  };
  return `<article class="job"><div class="job-head"><strong class="job-id">#${esc(j.id.slice(-8).toUpperCase())}</strong><span class="badge ${["pending", "failed", "expired", "file_lost"].includes(j.status) ? "amber" : ""}">${esc(labels[j.status] || j.status)}</span><strong>${money(j.amount)}</strong></div><div class="job-details">${num(j.pages)} পাতা × ${num(j.copies)} কপি · ${j.color ? "Color" : "B&W"} · ${esc(j.duplex || "off")} duplex · ${esc(j.kind || "document")} · ${esc(new Date(j.created).toLocaleString("bn-BD"))}${j.status === "file_lost" ? " · হারানো server file: paid হলে refund/reconcile প্রয়োজন। কোনো automatic reprint নয়।" : j.deleted ? " · Server file মুছে দেওয়া হয়েছে" : ""}</div><div class="job-actions">${["queued", "printing", "submitted", "attention"].includes(j.status) && !j.deleted ? `<a class="btn small outline" href="/api/jobs/${esc(j.id)}/document" target="_blank" rel="noopener">PDF খুলুন ↗</a>` : ""}${(choices[j.status] || []).map(([s, t]) => `<button class="btn small ${s === "cancelled" || s === "failed" ? "outline danger" : ""}" data-job="${esc(j.id)}" data-status="${s}">${t}</button>`).join("")}</div></article>`;
}
async function loadJobs() {
  try {
    const jobs = await api("/api/jobs");
    if (!$("#jobs")) return;
    $("#jobs").innerHTML = jobs.length
      ? jobs.map(jobHTML).join("")
      : '<div class="empty"><span>▤</span>কাউন্টার প্রস্তুত। প্রথম অর্ডারের অপেক্ষায়।<br>আপনার QR বা দোকানের লিংক কাস্টমারকে দিন।</div>';
    const today = new Date().setHours(0, 0, 0, 0),
      done = jobs.filter((j) => j.status === "completed" && j.updated >= today);
    $("#stat-orders").textContent = num(
      jobs.filter((j) => j.created >= today).length,
    );
    $("#stat-pending").textContent = num(
      jobs.filter((j) =>
        ["pending", "queued", "printing", "submitted", "attention"].includes(
          j.status,
        ),
      ).length,
    );
    $("#stat-prints").textContent = num(
      done.reduce((a, j) => a + j.pages * j.copies, 0),
    );
    $("#stat-earned").textContent = money(
      done.reduce((a, j) => a + j.amount, 0),
    );
  } catch (err) {
    if (err.status === 401) {
      clearInterval(refreshTimer);
      location.assign("/");
    } else if ($("#jobs")) $("#jobs").textContent = err.message;
  }
}
async function dashboard() {
  if (!me) {
    app.innerHTML =
      '<div class="loading"><h2>আপনার দোকানে লগইন করুন</h2><button class="btn" id="dashboard-login">লগইন →</button></div>';
    $("#dashboard-login").onclick = () => auth();
    return;
  }
  const link = location.origin + "/shop/" + me.id;
  app.innerHTML = `<section class="page"><div class="page-top"><div><div class="eyebrow"><span class="status-dot"></span> YOUR DIGITAL PRINT COUNTER</div><h1>${esc(me.name)}</h1><p>স্বাগতম। আজকের অর্ডারগুলো এক নজরে।</p></div><div class="actions"><a class="btn small outline" href="${esc(link)}" target="_blank" rel="noopener">কাস্টমার পেজ ↗</a><button class="btn small outline" id="logout">লগআউট</button></div></div><div class="stats"><div class="stat"><small>আজকের অর্ডার</small><strong id="stat-orders">—</strong></div><div class="stat"><small>অপেক্ষমাণ কাজ</small><strong id="stat-pending">—</strong></div><div class="stat"><small>আজকে সম্পন্ন পাতা</small><strong id="stat-prints">—</strong></div><div class="stat"><small>সম্পন্ন প্রিন্টের মূল্য</small><strong id="stat-earned">—</strong></div></div><div class="dashboard-layout"><div><div class="note">ℹ &nbsp; Counter payment · Manual printing<br>টাকা নিশ্চিত করুন → প্রিন্ট শুরু করুন → PDF খুলে প্রিন্ট দিন → কাগজ বের হওয়ার পরে সম্পন্ন করুন। Copies ও color print dialog-এ মিলিয়ে নিন। সম্পন্ন/বাতিল করলে server file মুছে যাবে।</div><div class="panel"><div class="page-top"><h2>সাম্প্রতিক অর্ডার</h2><button class="btn small outline" id="refresh">↻ Refresh</button></div><p class="sub">সর্বশেষ ২০০ অর্ডার থেকে হিসাব · প্রতি ১০ সেকেন্ডে আপডেট · আপনার ডিভাইসের তারিখ অনুযায়ী আজকের হিসাব</p><div id="jobs" aria-live="polite">লোড হচ্ছে…</div></div></div><aside><div class="panel"><h2>আপনার দোকানের QR</h2><img class="qr" src="/api/qr?url=${encodeURIComponent(link)}" alt="${esc(me.name)} দোকানের QR code"><button class="btn small full outline" id="copy-link">দোকানের লিংক কপি ↗</button><a class="text-button" href="/api/qr?url=${encodeURIComponent(link)}" download="QRBD-shop-QR.png">↓ QR ডাউনলোড</a><p class="fine mono">Shop ID: ${esc(me.id)}</p></div><div class="panel"><h2>দোকানের সেটিংস</h2><form id="settings"><label><input type="checkbox" name="isOpen" ${me.isOpen ? "checked" : ""}>দোকান খোলা আছে</label><div class="two"><label>B&W / পাতা<input type="number" name="bw" min="1" max="10000" step=".01" required value="${me.bw}"></label><label>Color / পাতা<input type="number" name="color" min="1" max="10000" step=".01" required value="${me.color}"></label></div><label>কাস্টমারকে নোটিশ<textarea name="message" maxlength="200" placeholder="যেমন: আজ Color print বন্ধ">${esc(me.message)}</textarea></label><button class="btn small full" type="submit">সেটিংস সংরক্ষণ করুন</button><p class="form-error" id="settings-error"></p></form></div></aside></div></section>`;
  $("#logout").onclick = async () => {
    try {
      await api("/api/logout", { method: "POST" });
      location.assign("/");
    } catch (e) {
      toast(e.message);
    }
  };
  $("#copy-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("দোকানের লিংক কপি হয়েছে।");
    } catch {
      toast("দোকানের লিংক: " + link);
    }
  };
  $("#refresh").onclick = loadJobs;
  $("#settings").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(e.target));
      values.isOpen = e.target.elements.isOpen.checked;
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      toast("সেটিংস সংরক্ষিত হয়েছে।");
      $("#settings-error").textContent = "";
    } catch (err) {
      $("#settings-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  $("#jobs").onclick = async (e) => {
    const b = e.target.closest("button[data-job]");
    if (!b) return;
    const status = b.dataset.status;
    if (
      ["completed", "failed", "cancelled"].includes(status) &&
      !confirm(
        status === "completed"
          ? "সব কাগজ ঠিকভাবে বের হয়েছে? নিশ্চিত করলে server file মুছে যাবে।"
          : "এই কাজ বন্ধ করে server file মুছে দিতে চান?",
      )
    )
      return;
    b.disabled = true;
    try {
      await api("/api/jobs/" + b.dataset.job, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadJobs();
      toast("অর্ডার আপডেট হয়েছে।");
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  };
  await loadJobs();
  refreshTimer = setInterval(loadJobs, 10000);
  try {
    const advanced = await import("/advanced.js");
    await advanced.mountDashboard(me);
  } catch (err) {
    toast("Advanced toolkit: " + err.message);
  }
}
async function receipt(id) {
  const r = await api("/api/receipt/" + id);
  const fingerprint = JSON.stringify(r);
  if (receiptCache === fingerprint && $("#online-payment")) {
    if (
      !["completed", "cancelled", "failed", "expired", "file_lost"].includes(
        r.status,
      )
    )
      receiptTimer = setTimeout(
        () => receipt(id).catch((e) => toast(e.message)),
        5000,
      );
    return;
  }
  receiptCache = fingerprint;
  app.innerHTML = `<section class="page"><div class="panel receipt"><div class="receipt-icon">${r.status === "completed" ? "✓" : "▤"}</div><div class="eyebrow centered">YOUR QRBD ORDER</div><h1>${esc(labels[r.status])}</h1><p class="mono">#${esc(id.slice(-8).toUpperCase())}</p><strong>${money(r.amount)}</strong><p>${num(r.pages)} পাতা × ${num(r.copies)} কপি · ${r.color ? "Color" : "B&W"}</p><p>${r.status === "pending" ? "কাউন্টারে টাকা দিয়ে আপনার order number দেখান।" : r.status === "completed" ? "আপনার প্রিন্ট সংগ্রহ করুন। ধন্যবাদ!" : "দোকানের কাউন্টারে আপনার অর্ডারের অবস্থা জানতে পারবেন।"}</p><p class="fine">${r.deleted ? "Server PDF মুছে দেওয়া হয়েছে।" : "ফাইল অস্থায়ীভাবে server-এ আছে। অর্ডার বাতিল বা মেয়াদ শেষ হলে মুছে যাবে।"}</p><div id="online-payment"></div><a class="btn outline" href="${esc(location.pathname)}">আরেকটি অর্ডার →</a><p class="fine">এই লিংক যার কাছে থাকবে সে order status দেখতে পারবে। ব্যক্তিগতভাবে রাখুন।</p></div></section>`;
  try {
    const advanced = await import("/advanced.js");
    await advanced.mountReceipt(r);
  } catch (e) {
    toast(e.message);
  }
  if (
    !["completed", "cancelled", "failed", "expired", "file_lost"].includes(
      r.status,
    )
  )
    receiptTimer = setTimeout(
      () => receipt(id).catch((e) => toast(e.message)),
      5000,
    );
}
async function customer(id) {
  const shop = await api("/api/shops/" + id);
  const saved = new URLSearchParams(location.search).get("receipt");
  if (saved && /^[a-f0-9]{24}$/.test(saved)) {
    await receipt(saved);
    return;
  }
  app.innerHTML = `<section class="page"><div class="page-top"><div><div class="eyebrow"><span class="status-dot"></span> ${shop.isOpen ? "দোকান খোলা আছে" : "দোকান এখন বন্ধ"}</div><h1>${esc(shop.name)}</h1><p>আপনার ফাইল, আপনার ফোন থেকেই।</p></div><span class="pill">POWERED BY QRBD</span></div>${shop.message ? `<p class="note">দোকানের নোটিশ: ${esc(shop.message)}</p>` : ""}<div class="shop-layout"><div class="panel"><div class="actions"><a class="btn small outline" href="/tools/${esc(id)}">Photo sheet / Resume maker ↗</a></div><h2>01 &nbsp; আপনার ডকুমেন্ট দিন</h2><form id="upload-form"><label class="drop"><strong>↥ &nbsp; PDF বা ছবি নির্বাচন করুন</strong><span>PDF · JPG · PNG / সর্বোচ্চ ৫টি / প্রতি ফাইল ১০ MB / মোট ২৫ MB</span><input type="file" name="files" accept="application/pdf,image/jpeg,image/png" multiple required ${shop.isOpen ? "" : "disabled"}></label><div id="file-list" class="sub"></div><h2>02 &nbsp; প্রিন্ট কেমন হবে?</h2><div class="mode-select"><label><input type="radio" name="color" value="bw" checked>B&W <small>${money(shop.bw)}/পাতা</small></label><label><input type="radio" name="color" value="color">Color <small>${money(shop.color)}/পাতা</small></label></div>${shop.duplex ? '<label>Duplex<select name="duplex"><option value="off">Single side</option><option value="long">Both sides · Long edge</option><option value="short">Both sides · Short edge</option></select></label>' : ""}<label>কত কপি?<input name="copies" type="number" min="1" max="20" value="1" required></label><label><input name="consent" type="checkbox" value="yes" required>অর্ডার প্রক্রিয়াকরণ ও দোকানে প্রিন্টের জন্য ফাইল পাঠাতে সম্মত।</label><p class="form-error" id="upload-error" role="alert"></p><button class="btn full" type="submit" ${shop.isOpen ? "" : "disabled"}>আপলোড করে অর্ডার তৈরি করুন ↗</button><p class="fine">আপলোড শেষে সার্ভার আসল পাতা গুনে মোট বিল দেখাবে। সর্বোচ্চ ২০০ পাতা। ছবি A4-এ fit করা হয়। দোকানে gateway configure থাকলে receipt থেকে online payment-এর option পাবেন।</p></form></div><aside><div class="panel"><div class="eyebrow">COUNTER PAYMENT</div><h2>বিল মিটিয়ে প্রিন্ট নিন।</h2><p class="sub">মূল্য = পাতা × কপি × প্রতি পাতার rate। Image প্রতি ১টি A4 পাতা। PDF-এর সব পাতা রাখা হয়।</p><hr><p>B&W <b>${money(shop.bw)} / পাতা</b></p><p>Color <b>${money(shop.color)} / পাতা</b></p><p class="fine">দোকানদার টাকা পাওয়া নিশ্চিত করার পরে print করবেন।</p></div><div class="note">♧ ফাইল কেবল এই প্রিন্টের জন্য<br><small>Completed হলে server file মুছে যায়। Unpaid ১ ঘণ্টা ও অন্য active file সর্বোচ্চ ২৪ ঘণ্টা রাখা হয়। দোকানের printer/browser copy-এর জন্য দোকানদার দায়ী। সংবেদনশীল নথি দিয়ে prototype পরীক্ষা করবেন না।</small></div></aside></div></section>`;
  const form = $("#upload-form");
  form.elements.files.onchange = () => {
    $("#file-list").textContent = Array.from(form.elements.files.files)
      .map((f) => f.name)
      .join(" · ");
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    b.textContent = "ফাইল প্রক্রিয়াকরণ চলছে…";
    $("#upload-error").textContent = "";
    try {
      const r = await api("/api/shops/" + id + "/jobs", {
        method: "POST",
        body: new FormData(form),
      });
      history.replaceState(null, "", location.pathname + "?receipt=" + r.id);
      await receipt(r.id);
    } catch (err) {
      $("#upload-error").textContent = err.message;
      b.disabled = false;
      b.textContent = "আবার চেষ্টা করুন ↗";
    }
  };
}
async function init() {
  try {
    me = await api("/api/me");
    $("#nav-account").textContent = "আমার কাউন্টার ↗";
  } catch {}
  try {
    if (location.pathname === "/dashboard") await dashboard();
    else if (location.pathname.startsWith("/tools/")) {
      const advanced = await import("/advanced.js");
      await advanced.tools(location.pathname.split("/")[2]);
    } else if (location.pathname.startsWith("/shop/"))
      await customer(location.pathname.split("/")[2]);
    else landing();
  } catch (err) {
    app.innerHTML = `<section class="page"><div class="panel"><h1>পেজটি লোড করা যায়নি</h1><p>${esc(err.message)}</p><a class="btn" href="/">হোমপেজে ফিরুন</a></div></section>`;
  }
}
init();
