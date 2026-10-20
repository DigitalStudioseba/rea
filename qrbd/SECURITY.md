# QRBD security

Development beta, not a security-audited production service. Before accepting
sensitive files, live funds or open registrations, complete `DEPLOY.md`'s checklist.

Do not post vulnerabilities with customer PDFs, session/device tokens, merchant
secrets, private database files or reproduction details enabling active abuse in
public Issues. Contact the repository owner through an appropriate private
channel. Use GitHub private vulnerability reporting if enabled by the owner.

Secrets belong only in private hosting configuration or the private persistent
data volume. Rotate a leaked device token in the owner's dashboard and merchant
credentials with the provider. Existing payment attempts use encrypted snapshots
of the credentials they were created with; coordinate revocation/reconciliation.
Losing the encryption key makes saved configs unreadable; do not rotate it by
simply deleting the disk/key file. Never restore old document-containing backups
as a way to undo deletion promises.

A successful CI build is not a penetration test, verified print output or payment
settlement. Simulated gateway results are test fixtures, not merchant evidence.
