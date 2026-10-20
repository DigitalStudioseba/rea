# QRBD 0.2 — QR-based print shop

Independent Bengali print-shop application, kept separate from REA's runtime,
dependencies and website. Not a rebrand of QR Se Print, no affiliation or copied
private code. **Feature implementation is not evidence of real provider/hardware
verification. See the verification matrix below.**

## Publish / deployment

See **[DEPLOY.md](DEPLOY.md)** for the standalone GitHub repository, Render
persistent-disk Blueprint, Docker/Caddy VPS deployment, custom domain and
private-beta enrollment. GitHub Pages cannot run this Node/SQLite backend.
A CI workflow validates the server/agent and attempts an Android debug build.
No hosting account or paid service is provisioned just by publishing the source.

## Run / preview

Requires Node.js >=22.19 (tested on 22.22.3; native SQLite is experimental).

```sh
cd qrbd
npm ci
npm start
# http://localhost:3000
```

In an Arena iframe only: `QRBD_EMBED_PREVIEW=1 npm start`. Leave that flag unset
in production: it disables anti-framing headers. Server binds `0.0.0.0`; frontend
calls same-origin relative URLs. `PORT=3000` by default.

Persistent private storage defaults to `.data/`; override with `QRBD_DATA_DIR`.
It contains accounts, encrypted gateway configurations, payment snapshots, sessions
and temporary PDFs. Never expose, publish or commit it. Back up records securely
without including customer PDFs. The initial v0.2 upgrade takes a SQLite snapshot
before modifying a populated v0.1 database. Keep those backups private and apply
an operator-defined retention policy. Additive migrations preserve existing shops
and jobs. Do not run multiple application instances against this prototype. `QRBD_FILE_DIR`
can place temporary PDFs outside the account/key disk. The Render Blueprint does
this to avoid provider disk snapshots capturing documents; those ephemeral PDFs
can vanish on restart/deploy. Missing jobs become `file_lost`, never an automatic
reprint or a claim of success; paid jobs require operator reconciliation/refund.

## Features and verification

| Feature | Implemented | Verification / limits |
| --- | --- | --- |
| Bengali landing, registration, QR, customer upload, dashboard | Yes | Real HTTP + Chromium desktop/mobile |
| Actual page count, copies, rates in BDT, shop isolation | Yes | HTTP tests including invalid files and tenant denial |
| Windows print agent | Python agent + download + device API | Python argument/integrity tests; **no real Windows/printer run** |
| Duplex and B&W/color/photo routing | Yes | Server claim/routing + browser settings tests; driver verification needed |
| Online print payments | Configurable aamarPay checkout and verification | **Simulated provider** tests; no real sandbox/live transaction |
| Android printing | Native Kotlin PrintManager companion source | **Not compiled or device-tested**; not a universal OTG driver |
| Mobile web app | Responsive website + install manifest | Chromium at 390px; not an offline document cache |
| WhatsApp printing | Official Cloud API webhook/media/reply pipeline | Signature/caption/webhook tests; **no real Meta media or message test** |
| Photo sheet | 4/6/8/10/12 images, 4x6 or A4 PDF | PDF dimensions/parse + browser order tests; not passport-certified |
| Resume maker | Classic/modern/compact multipage PDF | Generation + browser order tests; **English ASCII text only** |
| Referral | Link/signup tracking + paid activation reward ledger | Live-mode **simulated provider** test, not real money |
| Withdrawal requests/operator payout recording | Yes | Balance reservation/double-spend tests; **manual external transfer** |

Not implemented: universal raw USB/OTG drivers, silent Android background print,
Windows installer/tray/autostart/updater, automatic physical-output detection,
Bangla PDF resume shaping, image crop/rotate/brightness UI, smart scanner, rich
passport size presets, white-label partner sales, password recovery, email
verification and account export/deletion UI. No “same-to-same complete” claim.

## Basic printing workflow

1. Register a shop, open its customer link or download/display its QR.
2. Upload PDF/JPG/PNG, choose B&W/Color, copies and optional duplex. Server
   parses/merges files and snapshots the rate to calculate the bill.
3. Alternatively use **Photo sheet / Resume maker** to generate the PDF/order.
4. Receive counter cash and choose **টাকা পেয়েছি**, OR use configured online
   payment and explicit receipt verification.
5. Manual flow: **প্রিন্ট শুরু করুন** → **PDF খুলুন** → browser Print.
   Match copies, color, paper and printer in the print dialog yourself.
6. Agent flow: enable a device and route printers. Only paid `queued` orders are
   claimable; agents claim atomically and report `submitted` or `attention`.
7. **After checking actual paper output**, confirm completion in the dashboard.
   This deletes the server PDF. Failure/cancellation also deletes the server file.

Dashboard refreshes each 10 seconds, receipts each 5. Summary uses the most recent
200 retained jobs, not a complete accounting ledger. “Today” is the browser's
calendar date. A submission or spooler acknowledgement is not physical success.

## Windows auto-print agent

Source/download: `agent/windows_agent.py` and `/downloads/windows-agent.py`.
Requires Python >=3.10, Windows and a caller-installed SumatraPDF executable.
Nothing installs/updates Windows software or drivers automatically.

1. Dashboard → Printer routing: enter exact Windows printer names for B&W,
   color, duplex and photo. Duplex must be explicitly enabled.
2. Dashboard → Devices: generate a token (shown once). New token revokes the old
   device. One enabled Windows/Android device per shop.
3. Independently check SumatraPDF's integrity/origin. Pin its SHA256:

```powershell
Get-FileHash 'C:\Tools\SumatraPDF.exe' -Algorithm SHA256
$env:QRBD_AGENT_TOKEN = 'YOUR_PRIVATE_DEVICE_TOKEN'
python qrbd-windows-agent.py --url https://your-domain.example --sumatra 'C:\Tools\SumatraPDF.exe' --sha256 YOUR_VERIFIED_SHA256 --enable-printing
```

The explicit flag authorizes real print side effects. HTTPS only; no redirects
forward bearer tokens. Agent validates job ID/settings and PDF length/SHA256,
then runs a fixed executable using an argument array (`shell=False`). Printed
files are not commands. Executable checksum is rechecked for every job. Duplex
uses Sumatra's simplex/duplexlong/duplexshort settings. Photos use the printer's
selected paper size: match A4/4x6 manually before enabling a photo route.

Print invocation is **never automatically retried**. Status report alone is
idempotently retried. A claim blocks unresolved work on that device; after 15 min
without a report the server marks it `attention`, not `queued`. Reconcile output
and close the job before new work. The owner cannot finalize a currently active
agent claim. A crash leaves the local process lock behind intentionally; inspect
jobs before removing `~/.qrbd-agent.lock`. Per-job temp folders are cleaned on
normal exit; after abrupt termination, the operator must remove leftover OS temp
`qrbd-*` folders. Windows spooler/driver copies remain the shop's responsibility.

## Online payments

Use **your own merchant contract and approved aamarPay credentials**. Never put
secrets in chat, client JavaScript, Git or screenshots.

```sh
cp .env.example .env
# Generate the encryption key locally:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Set QRBD_SECRET_KEY and QRBD_PUBLIC_URL=https://your-domain.example in .env
npm run start:configured
```

Keep the encryption key stable and securely backed up; losing/changing it without
migration makes stored gateway configs/payment snapshots unreadable. Dashboard →
Online payment: set store ID, signature and sandbox/live mode. Secrets and
per-attempt credential snapshots use AES-256-GCM, never returned to browsers.

Receipt checkout collects customer name/email/phone and sends them to aamarPay;
QRBD does not store them in job/payment rows. Redirect destination is limited to
aamarPay HTTPS hosts. Public provider callback is **navigation only**, not proof.
Explicit verification calls the provider's transaction-check API and matches
success, status code, merchant transaction ID, store, BDT currency and exact
amount before queueing the job. Verification and queue transitions are idempotent.

**Sandbox never releases a real print, activates a real shop or credits a real
commission.** Use manual counter confirmation for physical test printing. A
successful payment arriving after deletion/cancellation/expiry is `paid_late`:
no automatic reprint; reconcile/refund externally. Competing checkouts are blocked.
Uncertain provider requests remain uncertain instead of blindly retrying a charge.
Failed/uncertain attempt recovery, refunds, reconciliation and chargebacks need
operator/provider support; they are not automatically resolved by this prototype.
No unattended webhook reconciliation service or accounting guarantee is supplied.

Implementation follows aamarPay's documented JSON checkout and transaction search
contracts, but **real sandbox and live requests were not run**. Network policy in
this workspace does not permit direct outbound aamarPay/Meta traffic. Deploy to
an authorized server with appropriate outbound access and verify merchant-specific
responses before switching to live. Source references:
https://aamarpay.readme.io/reference/search-transaction and
https://aamarpay.readme.io/reference/initiate-payment-json

## Android

See `android/README.md`. Kotlin native source uses Android Print Framework and a
compatible installed print service (vendor/Mopria etc.). Open in Android Studio,
JDK 17, SDK 35, Gradle 8.9. No APK/SDK/Gradle-wrapper binary is committed.

A device token is memory-only. Claiming a job and opening the system print dialog
is user-triggered. User must verify copies: Android's public PrintManager API
cannot preset them. Color/duplex/paper attributes are suggested, not guaranteed
by a driver. Job status goes to submitted/attention; physical completion stays
manual. USB availability depends on installed vendor print service; **no universal
silent OTG claim**. App termination during a job requires operator reconciliation.

## WhatsApp Business Cloud API

Official Meta API, not WhatsApp Web automation or a personal linked-device bot.
Requires approved business number, access token, App Secret, webhook verify token
and a shop ID. One receiving number/shop per deployment in this version.

Set `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`,
`WA_SHOP_ID` and supported `WA_GRAPH_VERSION` in the server's private environment.
Configure a Meta webhook at `https://your-domain.example/integrations/whatsapp`,
subscribe to `messages`. HMAC-SHA256 is checked on the raw body before processing.

Customer sends PDF/JPG/PNG with optional caption:

```text
color copies=2 duplex=long
```

Default is `bw copies=1 duplex=off`. Conflicting/invalid options are rejected.
Files are fetched only from approved Meta HTTPS media hosts without redirects,
with byte/time bounds. A normal unpaid job is created, and a receipt link is
replied to. Payment must be confirmed before any print. Incoming messages are
deduplicated by message ID, not automatically replayed. Processing concurrency
and queue length are bounded. Message IDs/status are retained for 30 days (pruned
at startup); phone/message content is not persisted by this app.

**The worker queue is in-memory.** A restart during accepted work can require
customer/operator reconciliation; no guarantee of exactly-once or durable message
delivery. Meta/media/reply operations and current API availability need a real
integration test. Business approval, templates/window rules and Meta charges are
not bypassed. Customer phone/document data is also handled by Meta under its
terms, not QRBD's server-deletion policy.

## Referral and platform activation

Referral URL: `https://your-domain.example/?ref=SHOP_ID`. New shop registration
tracks that referrer. Commission is **not** credited for registration alone,
sandbox success, counter receipts or a customer's ordinary print payment.

Optionally configure a separate platform merchant via `QRBD_BILLING_STORE`,
`QRBD_BILLING_SIGNATURE`, `QRBD_BILLING_MODE` and `QRBD_ACTIVATION_TAKA` (default
৳500, minimum ৳100). This is an optional one-time activation product, **not a
subscription/licensing gate**: prototype features remain available without it.
Only its verified LIVE fee credits ৳100 exactly once to the referring shop.
Refunds/abuse screening and commission reversals are operator responsibilities;
review before paying out. Real provider fees/taxes still apply.

Minimum withdrawal ৳500. Request atomically reserves available earned balance;
it does **not** send money. Local server operator reviews then sends money
externally. Record actual external payout/reference using:

```sh
node --env-file=.env admin.mjs withdrawals
node --env-file=.env admin.mjs mark-paid WITHDRAWAL_ID ACTUAL_EXTERNAL_REFERENCE --confirm-external-payment
# Or reject a pending request, releasing its reserved balance:
node --env-file=.env admin.mjs reject WITHDRAWAL_ID 'Reason for rejection'
```

No public admin payout endpoint. Command requires local database access. Never
mark paid before confirming actual transfer. No automated mobile-wallet transfer.

## Privacy, security and remaining production work

Limits: 5 files, 10 MiB each, 25 MiB combined, 200 pages, 1–20 copies. Inputs are
parsed by magic bytes/document structure. Resume text is bounded English ASCII;
long words/unsupported text fail explicitly. Uploaded PDFs remain untrusted.

Terminal jobs delete server PDF synchronously. Pending files expire after 1 hour,
other active files after 24 hours, checked each minute/startup. Downtime delays
deletion. Deleted job records expire 7 days after creation. Startup removes orphan
PDFs left by interrupted uploads. Payment/referral/payout records persist for
operator reconciliation; they are not covered by weekly job cleanup. Browser,
printer, Meta, payment-provider and backup copies are outside this mechanism.
It is not certified secure erasure.

Bcrypt passwords; random hashed HttpOnly/SameSite sessions, HTTPS Secure cookies;
mutation Origin/custom-header checks; cross-shop checks on documents/settings;
revocable hashed device tokens; encrypted merchant secrets; strict signature
checks for public webhook. Basic in-memory IP limits are not distributed abuse
protection and may group users together behind a proxy.

**Development implementation, not production-hardened.** Still needs real Windows
and Android verification; real gateway/Meta staging; deployment/HTTPS/private
persistent storage; monitoring; restricted backups; chargeback/refund/commission
reversal workflows; email verification/recovery/account deletion; isolated
untrusted-document parsing and malware checks; global quotas/concurrency bounds;
load/penetration/accessibility tests; secure installer/signing and support model.
Do not test using sensitive identity, banking or confidential documents.

## Tests

```sh
npm test
npm run test:agent
# Requires a separately installed compatible Chromium/Chrome (not bundled):
BROWSER_EXECUTABLE=/absolute/path/to/chromium npm run test:browser
# Containers may explicitly need BROWSER_ARGS='["--no-sandbox"]'.
```

- Node tests: real HTTP/SQLite workflows, tenant/CSRF checks, generation/routing,
  device enrollment/revocation, claim ownership/no redelivery, report idempotency,
  ciphertext integrity, payment-field rejection, simulated sandbox vs live mode,
  forged redirects, late payment, referral idempotency and withdrawal reservations.
- Python tests: fixed argument construction/validation, duplex/photo settings,
  executable checksum and no redirect forwarding; no printer execution.
- Checked-in Chromium smoke: desktop/mobile registration, dashboard, route/device
  settings, upload/receipt/manual lifecycle/deletion, duplex selection, photo and
  resume orders; no unexpected console errors or horizontal mobile overflow.
- Android compilation, physical output, true gateway settlement and real WhatsApp
  end-to-end are **not verified**. Simulated gateway does not establish live behavior.

Noto Sans Bengali font subsets are self-hosted under SIL OFL; see
`public/fonts/OFL.txt`. No third-party font CDN.
