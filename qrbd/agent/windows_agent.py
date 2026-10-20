#!/usr/bin/env python3
"""QRBD Windows agent. Explicitly opt-in printing; no automatic installer or updater.
Requires Python 3.10+ and a caller-installed, SHA256-pinned SumatraPDF executable.
Never interprets uploaded content as commands. Physical completion stays manual.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_PDF = 32 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Never forward a device bearer token to a redirected host.


def request(base, token, endpoint, body=None, binary=False):
    req = urllib.request.Request(base + endpoint,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token, "x-qrbd-request": "1",
                 "Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        data = response.read(MAX_PDF + 1 if binary else 256001)
        if len(data) > (MAX_PDF if binary else 256000):
            raise ValueError("Response exceeds limit")
        return data if binary else json.loads(data)


def print_arguments(job, executable, pdf):
    if not re.fullmatch(r"[a-f0-9]{24}", str(job.get("id", ""))):
        raise ValueError("Invalid job ID")
    copies = job.get("copies")
    if type(copies) is not int or not 1 <= copies <= 20:
        raise ValueError("Invalid copies")
    printer = job.get("printer")
    if not isinstance(printer, str) or not printer or printer.startswith("-") or len(printer) > 150 or any(ord(c) < 32 for c in printer):
        raise ValueError("Invalid printer name")
    duplex = job.get("duplex", "off")
    if duplex not in ("off", "long", "short"):
        raise ValueError("Invalid duplex mode")
    if type(job.get("color")) is not bool:
        raise ValueError("Invalid color")
    settings = [str(copies) + "x", "color" if job["color"] else "monochrome",
                {"off": "simplex", "long": "duplexlong", "short": "duplexshort"}[duplex], "fit"]
    if job.get("kind") != "photo":
        settings.append("paper=A4")
    return [str(executable), "-print-to", printer, "-print-settings", ",".join(settings), "-silent", str(pdf)]


def executable_digest(executable):
    value = hashlib.sha256()
    with executable.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest().lower()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Your QRBD HTTPS origin, no path")
    parser.add_argument("--sumatra", required=True, type=Path, help="Absolute SumatraPDF.exe path")
    parser.add_argument("--sha256", required=True, help="Independently verify your Sumatra executable checksum")
    parser.add_argument("--enable-printing", action="store_true", help="Required explicit consent to real printing")
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.url)
    if origin.scheme != "https" or not origin.netloc or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        parser.error("Use a HTTPS origin with no credentials, path, query or fragment")
    if sys.platform != "win32" or not args.enable_printing:
        parser.error("Windows only; --enable-printing explicitly authorizes printer side effects")
    if not args.sumatra.is_absolute() or not args.sumatra.is_file():
        parser.error("Provide an existing absolute SumatraPDF.exe path")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", args.sha256):
        parser.error("Provide SHA256 hex checksum")
    token = os.environ.get("QRBD_AGENT_TOKEN", "")
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        parser.error("Set QRBD_AGENT_TOKEN from the owner's device enrollment screen")
    base = args.url.rstrip("/")
    print("QRBD agent enabled. Print submission is NOT physical completion. Ctrl+C to stop.")
    # Single local process lock. A crash leaves it behind intentionally; operator must
    # reconcile outstanding jobs before manually removing the lock and restarting.
    lock = Path.home() / ".qrbd-agent.lock"
    try:
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error("Agent lock exists. Reconcile jobs first; do not start a second agent.")
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    try:
        while True:
            try:
                packet = request(base, token, "/api/agent/claim", {})
                job = packet.get("job")
                if not job:
                    if packet.get("attention") or packet.get("error"):
                        print("Operator action needed; no job retried.")
                    time.sleep(5)
                    continue
                job_id = job.get("id", "")
                if not re.fullmatch(r"[a-f0-9]{24}", job_id):
                    raise ValueError("Invalid job ID")
                report = "attention"
                try:
                    if executable_digest(args.sumatra) != args.sha256.lower():
                        raise ValueError("Executable checksum changed; printing stopped")
                    content = request(base, token, "/api/agent/jobs/" + job_id + "/document", binary=True)
                    if not content.startswith(b"%PDF-") or len(content) != job["bytes"] or hashlib.sha256(content).hexdigest() != job["sha256"]:
                        raise ValueError("Document integrity check failed")
                    with tempfile.TemporaryDirectory(prefix="qrbd-") as folder:
                        pdf = Path(folder) / "document.pdf"
                        pdf.write_bytes(content)
                        command = print_arguments(job, args.sumatra, pdf)
                        result = subprocess.run(command, shell=False, timeout=120,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        if result.returncode == 0:
                            report = "submitted"
                except Exception:
                    print("Job", job_id, "needs operator review; not retried.")
                # Retry only the idempotent status report, NEVER the print command.
                for attempt in range(3):
                    try:
                        request(base, token, "/api/agent/jobs/" + job_id + "/report", {"status": report})
                        break
                    except Exception:
                        if attempt == 2:
                            print("Report unconfirmed; reconcile job before any reprint.")
                        time.sleep(3)
            except (urllib.error.URLError, ValueError, KeyError):
                print("Connection/configuration error; no job automatically retried.")
                time.sleep(10)
    except KeyboardInterrupt:
        print("Agent stopped. Review any printing job in your dashboard.")
    finally:
        lock.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
