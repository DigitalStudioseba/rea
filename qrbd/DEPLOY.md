# Publish QRBD on GitHub and the web

> The GitHub repository and the running website are different things. This is
> a dynamic Node/SQLite service, **not a GitHub Pages/static hosting site**.
> A public website does not imply printer, payment or WhatsApp readiness.

## Repository layout

In the standalone QRBD repository, `package.json`, `Dockerfile` and `render.yaml`
are at the root. In the original REA workspace they live under `qrbd/`.
The tracked publishing branch remains `arena/607ed415-rea`; no `main` switch is
needed. The standalone repo has its own default branch with that same name.

Only application source, tests, configuration templates and licensed fonts are
published. `.env`, `.data`, encryption keys, SQLite/WAL files, uploaded PDFs,
node_modules, local Android config and generated APKs must never be committed.
Do not put live merchant tokens in GitHub Actions logs or Issues.

## Create/upload the GitHub repository

Repository: https://github.com/DigitalStudioseba/qrbd

When publishing through the assistant, only QRBD source is exported to this
standalone repository; the parent REA history and private runtime files are not
part of the upload.

If the GitHub App connection cannot create repositories, GitHub reports
`Resource not accessible by integration`. No repository is created in that case.
Have the account owner create an **empty** repository named `qrbd` at
https://github.com/new?name=qrbd and grant the GitHub connection access to it.
No passwords, PATs or 2FA codes need to be shared with this assistant.

The supplied `qrbd-github-ready.zip` contains standalone repository-root files
(not a nested `qrbd/` directory). Extract it, including hidden `.github/` and
`.dockerignore` files. With your own GitHub authentication configured locally:

```sh
# Run inside the extracted directory, not the parent REA repository.
git init --initial-branch=arena/607ed415-rea
git add .
git commit -m "feat: add QRBD print-shop beta and deployment setup"
git remote add origin https://github.com/DigitalStudioseba/qrbd.git
git push -u origin arena/607ed415-rea
```

Use an empty destination (no initialized README/.gitignore) to avoid unrelated
history. Set that branch as the repository default in GitHub settings if needed.
If you upload through the GitHub website instead, make sure the hidden `.github`
workflow and `.dockerignore` files are included and all source is at repo root.
Do not upload the parent REA checkout or any live `.env`/`.data` directory.
A successful upload/push starts the CI workflow; inspect its actual results.

## Option A — Render persistent Node service

A Render Blueprint is supplied as `render.yaml`. It uses a **paid Starter service
and a 1 GB persistent disk** for SQLite/accounts/encryption key. Customer PDFs use
   a separate ephemeral path to avoid the persistent disk's automatic snapshots. Review the
current Render price yourself. **No paid hosting resources are created simply
by creating/pushing the GitHub repo.**

1. Sign in to your own Render account and authorize the new GitHub repository.
2. New → Blueprint → choose the standalone QRBD repository/default branch.
3. Review its region, plan and disk cost; only then approve deployment.
4. On successful deployment, open the HTTPS service URL supplied by Render.
5. The server uses `RENDER_EXTERNAL_URL` as its public origin automatically.
   A private stable encryption key is generated on the persistent disk if no
   `QRBD_SECRET_KEY` environment override is set.
6. Render generates `QRBD_REGISTRATION_CODE` privately. Read it in the service's
   Environment settings. Enter that value in the registration form's **Private
   beta invitation code** when creating your shop. Do not send it in chat or
   publish it. The public homepage does not require it.
7. Register a shop, display its QR, upload a harmless sample and test the manual
   counter-payment/printing flow before giving access to customers.

GitHub Actions checks code and tries to build an Android **debug test APK**.
The Blueprint deploys after checks pass; a failed Android job may block deployment.
Inspect the actual build logs, not a green-looking landing page. An APK artifact,
when built successfully, is in Actions → QRBD checks → Artifacts. It is a test
APK, not a production-signed Play Store release or printer compatibility proof.

The Blueprint sets `QRBD_FILE_DIR=/tmp/qrbd-print-files`. Files in that directory
are deliberately ephemeral: a deployment/restart can remove unfinished documents.
On startup the server closes missing-file jobs as `file_lost`; it does **not**
pretend they printed or automatically retry them. If an affected job was already
paid, the shop must reconcile/refund and ask the customer to upload again. Do not
deploy while paid jobs are outstanding. Render snapshots the persistent disk
outside this app's control; moving PDFs onto it would change the retention policy.

Do **not** remove the persistent disk or run multiple instances with independent
SQLite databases. Render disk-backed service restarts/deploys can interrupt
printing and in-memory WhatsApp work; reconcile outstanding jobs afterward.
Free ephemeral hosting is unsuitable for this app's persistent records/key.

### Custom domain

1. Add your domain in Render → service → Settings → Custom Domains.
2. Set DNS exactly as Render instructs; wait for its certificate to become valid.
3. Set `QRBD_PUBLIC_URL=https://your-domain.example` (origin only: no trailing
   path, username, query or fragment), then redeploy/restart.
4. Re-download the shop QR so customers scan the permanent domain, not the old
   service URL. Recheck payment return and WhatsApp webhook configuration.

## Option B — Your own VPS + Docker/Caddy

Requires a server with Docker Engine/Compose, an owned domain pointing to it,
ports 80/443 open, adequate disk and an operator-managed backup policy. Do not
expose container port 3000 directly or mount the Docker socket into the app.

```sh
git clone --branch arena/607ed415-rea https://github.com/DigitalStudioseba/qrbd.git
cd qrbd
cp .env.example .env
# Privately edit .env:
# QRBD_DOMAIN=print.your-domain.example
# QRBD_PUBLIC_URL=https://print.your-domain.example
# QRBD_REGISTRATION_CODE=<random value of at least 16 characters>
# Leave QRBD_SECRET_KEY empty to generate it on the persistent volume,
# or provide your own 32-byte base64 key and protect its backup.
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=50 qrbd
```

Caddy obtains/renews HTTPS certificates. It is the one trusted proxy hop. The app
runs as a non-root user with a read-only image and a private writable data volume.
Keep `.env` private (`chmod 600 .env` on Linux). `docker compose down` keeps data;
**do not use `down --volumes`** unless intentional permanent deletion is wanted.
For upgrades: back up SQLite consistently and privately, pull this same branch,
then `docker compose up -d --build`. Never back up customer PDFs unintentionally.
Do not copy a live SQLite main file without its WAL; use a consistent SQLite
backup or stop the app while snapshotting the private volume.

Docker/Caddy configurations are provided, but **this sandbox did not have a
Docker daemon and no image was built or paid/VPS deployment performed here**.
GitHub/host logs must confirm the actual build and runtime result.

## Environment and public-beta safeguards

Production refuses to start without a valid HTTPS public URL and either a private
registration code or explicit `QRBD_OPEN_REGISTRATION=true`. Keep private beta
registration until an independent security/privacy review. Open registration is
an operator opt-in, not the default of the deployment template.

- `NODE_ENV=production`
- `QRBD_DATA_DIR`: private persistent account/SQLite/key directory
- `QRBD_FILE_DIR`: optional distinct document directory (Render uses ephemeral
  storage to avoid document snapshot backups); missing-file jobs fail closed
- `QRBD_PUBLIC_URL`: permanent HTTPS origin (Render URL can be inferred)
- `QRBD_REGISTRATION_CODE`: private beta shop enrollment code
- `QRBD_SECRET_KEY`: optional explicit 32-byte base64 key; otherwise production
  stores the generated key as `.encryption-key` in the private data directory
- `QRBD_TRUST_PROXY_HOPS`: your real proxy hop count, not an arbitrary trust-all
- Optional platform activation: `QRBD_BILLING_*`, `QRBD_ACTIVATION_TAKA`
- Optional official WhatsApp: `WA_*` variables described in README

Use separate sandbox and live merchant configurations. Never enable live mode
before independently verifying amount/currency/store/transaction matching, late
payments, cancellation, refunds and real settlement in your merchant account.
Do not grant the site real merchant credentials via GitHub public files.

## Before accepting real customer documents/money

- [ ] HTTPS/domain, permanent QR URLs, private persistent storage and restore test.
- [ ] Valid local privacy notice, contact details, legal/refund terms and applicable
      tax/business obligations. Do not present a generic prototype as certified.
- [ ] Capacity limits, isolated untrusted PDF/image parsing, malware handling,
      security review, global quotas, monitoring and incident response.
- [ ] Email verification, password recovery, account deletion/export workflows.
- [ ] Real Windows printers: copies, B&W/color, duplex, photo paper, offline and
      ambiguous-output recovery. Android build/install and physical print test.
- [ ] Actual aamarPay sandbox → approved live test/refund, and Meta-number tests.
- [ ] Fraud/commission reversal handling and actual payout audit/reconciliation.

Until these are done, publish as a **private-enrollment development beta**, not
as a fully verified production print/payment service.
