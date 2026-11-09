"""Pengiriman email: SMTP atau Resend. Bila keduanya kosong, hanya dicatat di log."""
import asyncio, logging, smtplib, json, urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List
from . import config as C

log = logging.getLogger("crk.mail")


def ul(items: List[str]) -> str:
    if not items:
        return "<p style='color:#6B625A'>–</p>"
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def wrap(title: str, body: str) -> str:
    return f"""<div style="background:#ECE4D4;padding:24px;font-family:Arial,sans-serif;color:#212121">
<div style="max-width:620px;margin:auto;background:#F4EFE4;border:1px solid #D9CDB8;border-radius:12px;overflow:hidden">
<div style="background:#B42F27;color:#ECE4D4;padding:16px 20px;font-weight:800;letter-spacing:.1em;font-size:12px">CRK GROUP · EXPANSION TRACKER</div>
<div style="padding:20px;font-size:14px;line-height:1.5">{body}</div>
<div style="padding:12px 20px;font-size:11px;color:#6B625A;border-top:1px solid #D9CDB8">Email otomatis dari {title}. <a href="{C.PUBLIC_BASE_URL}" style="color:#B42F27">Buka tracker</a></div>
</div></div>"""


def _smtp_send(to: str, subject: str, html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = C.SMTP["from"]
    msg["To"] = to
    msg.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP(C.SMTP["host"], C.SMTP["port"], timeout=20) as s:
        s.ehlo()
        try:
            s.starttls()
        except Exception:
            pass
        if C.SMTP["user"]:
            s.login(C.SMTP["user"], C.SMTP["pass"])
        s.sendmail(C.SMTP["from"], [to], msg.as_string())


def _resend_send(to: str, subject: str, html: str):
    req = urllib.request.Request("https://api.resend.com/emails", method="POST",
                                 data=json.dumps({"from": C.SMTP["from"] or "Expansion Tracker <onboarding@resend.dev>", "to": [to], "subject": subject, "html": html}).encode(),
                                 headers={"Authorization": f"Bearer {C.RESEND_API_KEY}", "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=20).read()


async def send(to: str, subject: str, body_html: str) -> int:
    if not to:
        return 0
    html = wrap("CRK Expansion Tracker", body_html)
    try:
        if C.RESEND_API_KEY:
            await asyncio.to_thread(_resend_send, to, subject, html)
        elif C.SMTP["host"]:
            await asyncio.to_thread(_smtp_send, to, subject, html)
        else:
            log.info("[email tidak dikonfigurasi] ke=%s subjek=%s", to, subject)
            return 0
        return 1
    except Exception as e:
        log.warning("Gagal kirim email ke %s: %s", to, e)
        return 0


async def send_many(rcpts: List[str], subject: str, body_html: str) -> int:
    n = 0
    for r in dict.fromkeys(rcpts):
        n += await send(r, subject, body_html)
    return n
