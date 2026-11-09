"""CRK Expansion Tracker — backend FastAPI."""
import asyncio, base64, csv, hashlib, hmac, io, json, logging, os, secrets, time, uuid
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Query, UploadFile, File, Request
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import config as C
from .db import make_db
from . import mailer

log = logging.getLogger("crk")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="CRK Expansion Tracker", version="1.0.0")
db = make_db()
FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend")


# ---------------------------------------------------------------- util
def now() -> datetime:
    return datetime.now(C.TZ)


def iso(dt: Optional[datetime] = None) -> str:
    return (dt or now()).isoformat(timespec="microseconds")


def today() -> str:
    return now().strftime("%Y-%m-%d")


def this_month() -> str:
    return now().strftime("%Y-%m")


def nid() -> str:
    return uuid.uuid4().hex[:12]


def hash_pin(pin: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 60000).hex()
    return f"{salt}${h}"


def check_pin(pin: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
        return hmac.compare_digest(hash_pin(pin, salt), stored)
    except Exception:
        return False


def make_token(member_id: str, kind: str = "member", days: int = 30) -> str:
    exp = int(time.time()) + days * 86400
    payload = f"{kind}:{member_id}:{exp}"
    sig = hmac.new(C.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def parse_token(token: str) -> Optional[Dict]:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        kind, mid, exp, sig = raw.split(":")
        payload = f"{kind}:{mid}:{exp}"
        good = hmac.new(C.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(good, sig) or int(exp) < time.time():
            return None
        return {"kind": kind, "id": mid}
    except Exception:
        return None


def err(code: int, msg: str):
    raise HTTPException(status_code=code, detail=msg)


def days_between(a: str, b: Optional[str] = None) -> int:
    try:
        d1 = datetime.fromisoformat(a).astimezone(C.TZ).date()
    except Exception:
        return 0
    d2 = datetime.fromisoformat(b).astimezone(C.TZ).date() if b else now().date()
    return (d2 - d1).days


def fmt_month(m: str) -> str:
    if not m:
        return "–"
    bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
    try:
        y, mo = m.split("-")
        return f"{bulan[int(mo) - 1]} {y}"
    except Exception:
        return m


def fmt_date_id(d: Optional[datetime] = None) -> str:
    d = d or now()
    bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    return f"{d.day} {bulan[d.month - 1]} {d.year}"


# ---------------------------------------------------------------- settings
async def get_settings() -> Dict:
    s = await db.get("settings", "main")
    if not s:
        s = {"id": "main", **C.DEFAULT_SETTINGS, "shareToken": secrets.token_urlsafe(18),
             "adminPinHash": hash_pin(C.DEFAULT_ADMIN_PIN), "createdAt": iso()}
        await db.put("settings", s)
    changed = False
    for k, v in C.DEFAULT_SETTINGS.items():
        if k not in s:
            s[k] = v
            changed = True
    if (s.get("slaVersion") or 1) < C.SLA_VERSION:
        s["stageSla"] = dict(C.DEFAULT_SLA)
        s["slaVersion"] = C.SLA_VERSION
        changed = True
    if changed:
        await db.put("settings", s)
    return s


def public_settings(s: Dict) -> Dict:
    return {k: v for k, v in s.items() if k not in ("adminPinHash",)}


# ---------------------------------------------------------------- auth
LOCK: Dict[str, Dict] = {}  # memberId -> {fails, until}


class Ctx(BaseModel):
    member: Optional[Dict] = None
    is_admin: bool = False
    role: str = ""


async def ctx_from_header(authorization: Optional[str] = Header(None)) -> Ctx:
    if not authorization or not authorization.lower().startswith("bearer "):
        return Ctx()
    t = parse_token(authorization.split(" ", 1)[1].strip())
    if not t:
        return Ctx()
    if t["kind"] == "admin":
        return Ctx(member={"id": "admin", "name": "Admin (PIN)", "role": "Admin"}, is_admin=True, role="Admin")
    m = await db.get("members", t["id"])
    if not m or not m.get("active", True):
        return Ctx()
    return Ctx(member=m, is_admin=bool(m.get("isAdmin")) or m.get("role") in C.FULL_ACCESS_ROLES, role=m.get("role", ""))


async def require_login(ctx: Ctx = Depends(ctx_from_header)) -> Ctx:
    if not ctx.member:
        err(401, "Silakan login terlebih dahulu")
    return ctx


async def require_admin(ctx: Ctx = Depends(ctx_from_header)) -> Ctx:
    if not ctx.member:
        err(401, "Silakan login terlebih dahulu")
    if not ctx.is_admin:
        err(403, "Hanya Admin yang boleh melakukan ini")
    return ctx


def can_edit(ctx: Ctx) -> bool:
    return ctx.is_admin or ctx.role in ("Manager", "SPV", "Surveyor", "SDO", "Legal", "Finance")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    role: str
    email: str = ""
    phone: str = ""
    pin: str = Field(min_length=4, max_length=6)

    @field_validator("pin")
    @classmethod
    def pin_digits(cls, v):
        if not v.isdigit():
            raise ValueError("PIN harus angka 4–6 digit")
        return v

    @field_validator("role")
    @classmethod
    def role_ok(cls, v):
        if v not in C.ROLES:
            raise ValueError("Role tidak dikenal")
        return v

    @field_validator("phone")
    @classmethod
    def phone_ok(cls, v):
        v = v.strip().replace(" ", "").replace("-", "")
        if v and not (v.startswith("08") and v.isdigit() and 9 <= len(v) <= 14):
            raise ValueError("Nomor WhatsApp harus format 08… (angka saja)")
        return v


class LoginIn(BaseModel):
    memberId: str
    pin: str


class AdminLoginIn(BaseModel):
    pin: str


def member_public(m: Dict) -> Dict:
    d = {k: v for k, v in m.items() if k not in ("pinHash",)}
    d["hasPin"] = bool(m.get("pinHash"))
    return d


@app.post("/api/auth/register")
async def register(body: RegisterIn):
    members = await db.find("members")
    if any(m["name"].strip().lower() == body.name.strip().lower() for m in members):
        err(400, "Nama sudah terdaftar. Login dengan PIN, atau minta Admin reset PIN.")
    m = {"id": nid(), "name": body.name.strip(), "role": body.role, "email": body.email.strip(), "phone": body.phone,
         "pinHash": hash_pin(body.pin), "active": True, "isAdmin": len(members) == 0 or body.role in C.FULL_ACCESS_ROLES,
         "createdAt": iso()}
    await db.put("members", m)
    return {"token": make_token(m["id"]), "member": member_public(m)}


@app.post("/api/auth/login")
async def login(body: LoginIn):
    m = await db.get("members", body.memberId)
    if not m or not m.get("active", True):
        err(404, "Anggota tidak ditemukan atau nonaktif")
    lk = LOCK.get(m["id"], {"fails": 0, "until": 0})
    if lk["until"] > time.time():
        err(423, f"Terkunci. Coba lagi dalam {int((lk['until'] - time.time()) / 60) + 1} menit atau minta Admin reset PIN.")
    if not m.get("pinHash"):
        if not (body.pin.isdigit() and 4 <= len(body.pin) <= 6):
            err(400, "PIN belum dibuat. Ketik PIN baru 4–6 digit angka; PIN itu akan menjadi PIN Anda.")
        await db.update("members", m["id"], {"pinHash": hash_pin(body.pin), "pinSetAt": iso()})
        return {"token": make_token(m["id"]), "member": member_public(await db.get("members", m["id"])), "pinCreated": True}
    if not check_pin(body.pin, m["pinHash"]):
        lk["fails"] += 1
        if lk["fails"] >= 5:
            lk["until"] = time.time() + 15 * 60
            lk["fails"] = 0
            LOCK[m["id"]] = lk
            err(423, "5 kali PIN salah. Akun dikunci 15 menit.")
        LOCK[m["id"]] = lk
        err(401, f"PIN salah. Sisa percobaan: {5 - lk['fails']}")
    LOCK.pop(m["id"], None)
    return {"token": make_token(m["id"]), "member": member_public(m)}


@app.post("/api/auth/admin-login")
async def admin_login(body: AdminLoginIn):
    s = await get_settings()
    if not check_pin(body.pin, s["adminPinHash"]):
        err(401, "PIN Admin salah")
    return {"token": make_token("admin", "admin", 1), "member": {"id": "admin", "name": "Admin (PIN)", "role": "Admin", "isAdmin": True}}


@app.get("/api/auth/members")
async def list_members_for_login():
    ms = await db.find("members", {"active": True}, sort=[("name", 1)])
    return [{"id": m["id"], "name": m["name"], "role": m["role"], "hasPin": bool(m.get("pinHash"))} for m in ms]


# ---------------------------------------------------------------- wilayah
class WilayahIn(BaseModel):
    nama: str = Field(min_length=2)
    kota: str = ""
    cluster: str = "Jabodetabek"
    spvId: str = ""
    surveyorId: str = ""
    status: str = "dibagi"
    targetKios: int = 1
    targetBulan: str = ""
    catatan: str = ""
    visitDate: str = ""
    visitNotes: str = ""

    @field_validator("cluster")
    @classmethod
    def cl(cls, v):
        if v not in C.CLUSTERS:
            raise ValueError("Cluster tidak dikenal")
        return v

    @field_validator("status")
    @classmethod
    def st(cls, v):
        if v not in C.WIL_STATUS:
            raise ValueError("Status wilayah tidak dikenal")
        return v


@app.post("/api/wilayah")
async def create_wilayah(body: WilayahIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat menambah wilayah")
    if any(x["nama"].strip().lower() == body.nama.strip().lower() for x in await db.find("wilayah")):
        err(400, "Nama wilayah sudah ada. Buka wilayah tersebut atau pakai nama lain.")
    w = {"id": nid(), **body.model_dump(), "photos": [], "createdAt": iso(), "updatedAt": iso(), "updatedBy": ctx.member["id"]}
    await db.put("wilayah", w)
    return w


@app.put("/api/wilayah/{wid}")
async def update_wilayah(wid: str, body: WilayahIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat mengubah wilayah")
    w = await db.get("wilayah", wid)
    if not w:
        err(404, "Wilayah tidak ditemukan")
    w.update(body.model_dump())
    w["updatedAt"] = iso()
    w["updatedBy"] = ctx.member["id"]
    await db.put("wilayah", w)
    return w


class AltIn(BaseModel):
    namaAlternatif: str = Field(min_length=2)
    kota: str = ""
    catatan: str = ""


@app.post("/api/wilayah/{wid}/alternatif")
async def wilayah_alternatif(wid: str, body: AltIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat mengubah wilayah")
    w = await db.get("wilayah", wid)
    if not w:
        err(404, "Wilayah tidak ditemukan")
    if any(x["nama"].strip().lower() == body.namaAlternatif.strip().lower() for x in await db.find("wilayah")):
        err(400, "Nama wilayah alternatif sudah ada. Pakai nama lain.")
    await db.update("wilayah", wid, {"status": "alternatif", "catatan": (w.get("catatan", "") + f"\nDiganti wilayah alternatif: {body.namaAlternatif}. {body.catatan}").strip(), "updatedAt": iso(), "updatedBy": ctx.member["id"]})
    nw = {"id": nid(), "nama": body.namaAlternatif, "kota": body.kota or w.get("kota", ""), "cluster": w.get("cluster", "Lainnya"),
          "spvId": w.get("spvId", ""), "surveyorId": w.get("surveyorId", ""), "status": "dibagi", "targetKios": w.get("targetKios", 1),
          "targetBulan": w.get("targetBulan", ""), "catatan": f"Alternatif dari {w['nama']}. {body.catatan}".strip(), "visitDate": "", "visitNotes": "",
          "photos": [], "createdAt": iso(), "updatedAt": iso(), "updatedBy": ctx.member["id"], "alternatifDari": wid}
    await db.put("wilayah", nw)
    return nw


@app.delete("/api/wilayah/{wid}")
async def delete_wilayah(wid: str, ctx: Ctx = Depends(require_admin)):
    if await db.count("kios", {"wilayahId": wid}):
        err(400, "Wilayah masih memiliki kios. Hapus atau pindahkan kios dulu.")
    await db.delete("wilayah", wid)
    return {"ok": True}


# ---------------------------------------------------------------- kios
class KiosIn(BaseModel):
    nama: str = Field(min_length=2)
    wilayahId: str
    alamat: str = ""
    mapsUrl: str = ""
    targetBuka: str = ""
    luas: float = 0
    sewaTahun: float = 0
    dp: float = 0
    pemilikNama: str = ""
    pemilikHp: str = ""
    vendorNama: str = ""
    rabNilai: float = 0
    renovasiPct: int = 0
    catatan: str = ""


def stage_pic_ok(ctx: Ctx, stage: int) -> bool:
    if ctx.is_admin or ctx.role in ("Manager", "SPV"):
        return True
    return ctx.role in C.STAGES[stage]["roles"]


async def next_code(cluster: str) -> str:
    prefix = C.CLUSTERS.get(cluster, "LN")
    ks = await db.find("kios")
    n = 0
    for k in ks:
        code = k.get("kode", "")
        if code.startswith(prefix + "-"):
            try:
                n = max(n, int(code.split("-")[1]))
            except Exception:
                pass
    return f"{prefix}-{n + 1:03d}"


async def add_log(kios_id: str, by: str, from_stage: int, to_stage: int, from_status: str, to_status: str, note: str):
    row = {"id": nid(), "kiosId": kios_id, "at": iso(), "byId": by, "fromStage": from_stage, "toStage": to_stage,
           "fromStatus": from_status, "toStatus": to_status, "note": note}
    await db.put("stagelog", row)
    return row


async def sync_wilayah_status(wilayah_id: str):
    w = await db.get("wilayah", wilayah_id)
    if not w or w.get("status") == "alternatif":
        return
    ks = await db.find("kios", {"wilayahId": wilayah_id})
    approved = [k for k in ks if k["stage"] >= 2 and k["status"] != "alternatif"]
    target = w.get("targetKios") or 1
    if len(approved) >= target and w["status"] != "selesai":
        await db.update("wilayah", wilayah_id, {"status": "selesai", "updatedAt": iso()})
    elif len(approved) < target and w["status"] == "selesai":
        await db.update("wilayah", wilayah_id, {"status": "cari", "updatedAt": iso()})
    elif approved and w["status"] in ("dibagi", "visit"):
        await db.update("wilayah", wilayah_id, {"status": "cari", "updatedAt": iso()})


@app.post("/api/kios")
async def create_kios(body: KiosIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat menambah kios")
    w = await db.get("wilayah", body.wilayahId)
    if not w:
        err(400, "Pilih wilayah yang valid")
    k = {"id": nid(), "kode": await next_code(w.get("cluster", "Lainnya")), **body.model_dump(), "stage": 0, "status": "ontrack",
         "spkFile": "", "photos": [], "openedAt": "", "createdAt": iso(), "createdBy": ctx.member["id"], "updatedAt": iso(), "updatedBy": ctx.member["id"]}
    await db.put("kios", k)
    await add_log(k["id"], ctx.member["id"], -1, 0, "", "ontrack", "Kandidat kios ditambahkan")
    return k


@app.put("/api/kios/{kid}")
async def update_kios(kid: str, body: KiosIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat mengubah kios")
    k = await db.get("kios", kid)
    if not k:
        err(404, "Kios tidak ditemukan")
    k.update(body.model_dump())
    k["updatedAt"] = iso()
    k["updatedBy"] = ctx.member["id"]
    await db.put("kios", k)
    return k


class StageIn(BaseModel):
    to: int
    note: str = ""


def check_gates(k: Dict, to: int):
    if to >= 2 and not (k.get("dp") or 0) > 0:
        err(400, "Isi nilai DP sebelum mengajukan Down Payment")
    if to >= 6 and not k.get("spkFile"):
        err(400, "Upload file SPK yang sudah ditandatangani sebelum melanjutkan ke Pelunasan Sewa")
    if to >= 6 and not (k.get("sewaTahun") or 0) > 0:
        err(400, "Isi nilai sewa per tahun sebelum Pelunasan Sewa")
    if to >= 9 and not (k.get("rabNilai") or 0) > 0:
        err(400, "Isi nilai RAB vendor yang disepakati sebelum Pengajuan Pembayaran Vendor")


@app.post("/api/kios/{kid}/stage")
async def change_stage(kid: str, body: StageIn, ctx: Ctx = Depends(require_login)):
    k = await db.get("kios", kid)
    if not k:
        err(404, "Kios tidak ditemukan")
    if k["status"] == "alternatif":
        err(400, "Kios berstatus alternatif. Reopen dulu.")
    cur = k["stage"]
    to = body.to
    if to < 0 or to > C.LAST_STAGE:
        err(400, "Tahap tidak valid")
    if to == cur:
        err(400, "Kios sudah berada di tahap ini")
    note = body.note.strip()
    if to > cur:
        if to - cur > 1 and not ctx.is_admin:
            err(400, "Stage hanya bisa maju satu langkah. Manager/Admin dapat melompat dengan catatan.")
        if to - cur > 1 and not note:
            err(400, "Catatan wajib diisi saat melompati stage")
        if not stage_pic_ok(ctx, cur):
            err(403, f"Tahap '{C.STAGES[cur]['n']}' hanya dapat dimajukan oleh {C.STAGES[cur]['pic']} atau SPV/Admin")
        check_gates(k, to)
    else:
        if not (ctx.is_admin or ctx.role == "SPV"):
            err(403, "Hanya SPV/Admin yang dapat mengembalikan tahap")
        if not note:
            err(400, "Catatan wajib diisi saat mengembalikan stage")
    fields = {"stage": to, "updatedAt": iso(), "updatedBy": ctx.member["id"]}
    if to > cur and k["status"] in ("blocked", "perhatian"):
        fields["status"] = "ontrack"  # hambatan dianggap selesai saat tahap maju
    if to == C.LAST_STAGE:
        fields["openedAt"] = today()
        fields["status"] = "ontrack"
    await db.update("kios", kid, fields)
    await add_log(kid, ctx.member["id"], cur, to, k["status"], fields.get("status", k["status"]), note or f"Tahap → {C.STAGES[to]['n']}")
    await sync_wilayah_status(k["wilayahId"])
    return await db.get("kios", kid)


class StatusIn(BaseModel):
    status: str
    note: str = ""


@app.post("/api/kios/{kid}/status")
async def change_status(kid: str, body: StatusIn, ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat mengubah status")
    if body.status not in ("ontrack", "perhatian", "blocked"):
        err(400, "Status tidak valid")
    k = await db.get("kios", kid)
    if not k:
        err(404, "Kios tidak ditemukan")
    if body.status in ("perhatian", "blocked") and not body.note.strip():
        err(400, "Catatan wajib diisi untuk status Perlu Perhatian / Blocked")
    await db.update("kios", kid, {"status": body.status, "updatedAt": iso(), "updatedBy": ctx.member["id"]})
    await add_log(kid, ctx.member["id"], k["stage"], k["stage"], k["status"], body.status, body.note.strip() or f"Status → {C.STATUS_LABEL[body.status]}")
    return await db.get("kios", kid)


class NoteIn(BaseModel):
    note: str = ""


@app.post("/api/kios/{kid}/alternatif")
async def kios_alternatif(kid: str, body: NoteIn, ctx: Ctx = Depends(require_login)):
    k = await db.get("kios", kid)
    if not k:
        err(404, "Kios tidak ditemukan")
    if k["status"] == "alternatif":  # buka kembali
        if not can_edit(ctx):
            err(403, "Role Anda tidak dapat membuka kembali kios")
        await db.update("kios", kid, {"status": "ontrack", "stage": 0, "updatedAt": iso(), "updatedBy": ctx.member["id"]})
        await add_log(kid, ctx.member["id"], k["stage"], 0, "alternatif", "ontrack", body.note.strip() or "Kios di-reopen sebagai kandidat")
    else:
        if not (ctx.is_admin or ctx.role in ("SPV", "Surveyor")):
            err(403, "Hanya SPV/Surveyor/Admin yang dapat menjadikan kios alternatif")
        if not body.note.strip():
            err(400, "Catatan alasan wajib diisi")
        await db.update("kios", kid, {"status": "alternatif", "updatedAt": iso(), "updatedBy": ctx.member["id"]})
        await add_log(kid, ctx.member["id"], k["stage"], k["stage"], k["status"], "alternatif", body.note.strip())
    await sync_wilayah_status(k["wilayahId"])
    return await db.get("kios", kid)


@app.delete("/api/kios/{kid}")
async def delete_kios(kid: str, ctx: Ctx = Depends(require_admin)):
    await db.delete("kios", kid)
    for r in await db.find("stagelog", {"kiosId": kid}):
        await db.delete("stagelog", r["id"])
    for r in await db.find("comments", {"kiosId": kid}):
        await db.delete("comments", r["id"])
    for r in await db.find("files", {"kiosId": kid}):
        try:
            os.remove(r["path"])
        except Exception:
            pass
        await db.delete("files", r["id"])
    return {"ok": True}


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@app.post("/api/kios/{kid}/comments")
async def add_comment(kid: str, body: CommentIn, ctx: Ctx = Depends(require_login)):
    if not await db.get("kios", kid):
        err(404, "Kios tidak ditemukan")
    c = {"id": nid(), "kiosId": kid, "byId": ctx.member["id"], "at": iso(), "text": body.text.strip()}
    await db.put("comments", c)
    # @mention → email
    members = await db.find("members")
    for m in members:
        if m.get("email") and ("@" + m["name"].split()[0].lower()) in body.text.lower():
            k = await db.get("kios", kid)
            asyncio.create_task(mailer.send(m["email"], f"Anda disebut di {k['nama']}", f"<p>{ctx.member['name']} menulis:</p><blockquote>{body.text}</blockquote><p><a href='{C.PUBLIC_BASE_URL}'>Buka Expansion Tracker</a></p>"))
    return c


@app.get("/api/kios/{kid}/timeline")
async def timeline(kid: str, ctx: Ctx = Depends(require_login)):
    logs = await db.find("stagelog", {"kiosId": kid})
    cms = await db.find("comments", {"kiosId": kid})
    members = {m["id"]: m["name"] for m in await db.find("members")}
    items = [{"type": "stage", **l, "byName": members.get(l["byId"], "Admin")} for l in logs] + \
            [{"type": "comment", **c, "byName": members.get(c["byId"], "Admin")} for c in cms]
    items.sort(key=lambda x: x["at"], reverse=True)
    return items


# ---------------------------------------------------------------- files
@app.post("/api/kios/{kid}/files")
async def upload_file(kid: str, kind: str = Query("photo"), file: UploadFile = File(...), ctx: Ctx = Depends(require_login)):
    if not can_edit(ctx):
        err(403, "Role Anda tidak dapat upload file")
    k = await db.get("kios", kid)
    if not k:
        err(404, "Kios tidak ditemukan")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        err(400, "Ukuran file maksimal 10 MB")
    os.makedirs(C.UPLOAD_DIR, exist_ok=True)
    fid = nid()
    ext = os.path.splitext(file.filename or "")[1].lower()[:8]
    path = os.path.join(C.UPLOAD_DIR, fid + ext)
    with open(path, "wb") as f:
        f.write(data)
    meta = {"id": fid, "kiosId": kid, "name": file.filename, "path": path, "kind": kind, "size": len(data), "at": iso(), "byId": ctx.member["id"]}
    await db.put("files", meta)
    url = f"/api/files/{fid}"
    if kind == "spk":
        await db.update("kios", kid, {"spkFile": url, "spkFileName": file.filename, "updatedAt": iso()})
    else:
        await db.update("kios", kid, {"photos": (k.get("photos") or []) + [{"id": fid, "url": url, "name": file.filename}], "updatedAt": iso()})
    return {"id": fid, "url": url, "name": file.filename}


@app.get("/api/files/{fid}")
async def get_file(fid: str):
    m = await db.get("files", fid)
    if not m or not os.path.exists(m["path"]):
        err(404, "File tidak ditemukan")
    return FileResponse(m["path"], filename=m.get("name") or fid)


# ---------------------------------------------------------------- computed state
def enrich_kios(k: Dict, logs_by_kios: Dict[str, List[Dict]], settings: Dict, members: Dict) -> Dict:
    st = C.STAGES[k["stage"]]
    logs = logs_by_kios.get(k["id"], [])
    entered = None
    for l in sorted(logs, key=lambda x: x["at"], reverse=True):
        if l["toStage"] == k["stage"] and l.get("fromStage") != l["toStage"]:
            entered = l["at"]
            break
    entered = entered or k.get("createdAt")
    days_in = days_between(entered) if entered else 0
    sla = (settings.get("stageSla") or {}).get(str(k["stage"]))
    last = max(logs, key=lambda x: x["at"]) if logs else None
    status = "selesai" if k["stage"] == C.LAST_STAGE else k["status"]
    active = k["status"] != "alternatif" and k["stage"] < C.LAST_STAGE
    out = dict(k)
    out.update({
        "stageName": st["n"], "stagePic": st["pic"], "fase": st["fase"], "statusKey": status,
        "statusLabel": C.STATUS_LABEL.get(status, status),
        "nextStage": C.STAGES[k["stage"] + 1]["n"] if k["stage"] < C.LAST_STAGE else "", "nextPic": C.STAGES[k["stage"] + 1]["pic"] if k["stage"] < C.LAST_STAGE else "",
        "daysInStage": days_in, "sla": sla, "lewatSla": bool(active and sla and days_in > sla),
        "stalled": bool(active and days_between(k.get("updatedAt") or k.get("createdAt")) >= (settings.get("stalledDays") or 7)),
        "lewatTarget": bool(active and k.get("targetBuka") and k["targetBuka"] < this_month()),
        "lastNote": (last or {}).get("note", ""), "lastAt": (last or {}).get("at", k.get("updatedAt")),
        "updatedByName": members.get(k.get("updatedBy"), ""),
    })
    return out


async def build_state(ctx: Optional[Ctx] = None) -> Dict:
    settings = await get_settings()
    members_raw = await db.find("members", sort=[("name", 1)])
    members = {m["id"]: m["name"] for m in members_raw}
    wil = await db.find("wilayah", sort=[("nama", 1)])
    kios = await db.find("kios", sort=[("updatedAt", -1)])
    logs = await db.find("stagelog")
    by = {}
    for l in logs:
        by.setdefault(l["kiosId"], []).append(l)
    wmap = {w["id"]: w for w in wil}
    ek = []
    for k in kios:
        e = enrich_kios(k, by, settings, members)
        w = wmap.get(k["wilayahId"], {})
        e["wilayahNama"] = w.get("nama", "–")
        e["cluster"] = w.get("cluster", "")
        ek.append(e)
    for w in wil:
        w["spvName"] = members.get(w.get("spvId"), "")
        w["surveyorName"] = members.get(w.get("surveyorId"), "")
        w["kiosCount"] = sum(1 for k in ek if k["wilayahId"] == w["id"] and k["status"] != "alternatif")
        w["approvedCount"] = sum(1 for k in ek if k["wilayahId"] == w["id"] and k["status"] != "alternatif" and k["stage"] >= 2)
    return {"settings": public_settings(settings), "members": [member_public(m) for m in members_raw], "wilayah": wil, "kios": ek,
            "stages": C.STAGES, "fases": C.FASES, "roles": C.ROLES, "roleLabel": C.ROLE_LABEL, "clusters": list(C.CLUSTERS.keys()),
            "statusLabel": C.STATUS_LABEL, "wilStatusLabel": C.WIL_STATUS_LABEL, "today": today(), "month": this_month(), "serverTime": iso()}


@app.get("/api/state")
async def state(ctx: Ctx = Depends(require_login)):
    s = await build_state(ctx)
    s["me"] = member_public(ctx.member) if ctx.member else None
    s["me"]["isAdmin"] = ctx.is_admin
    if not ctx.is_admin:
        s["settings"] = {k: v for k, v in s["settings"].items() if k != "shareToken"}
    return s


def summary(ek: List[Dict]) -> Dict:
    act = [k for k in ek if k["status"] != "alternatif"]
    approved = [k for k in act if k["stage"] >= 2]
    in_proc = [k for k in approved if k["stage"] < C.LAST_STAGE]
    open_ = [k for k in act if k["stage"] == C.LAST_STAGE]
    blocked = [k for k in in_proc if k["status"] == "blocked"]
    m = this_month()
    return {
        "beroperasi": len(open_), "dalamProses": len(in_proc), "kontrak": sum(1 for k in in_proc if k["fase"] == "Kontrak"),
        "renovasi": sum(1 for k in in_proc if k["fase"] == "Renovasi"), "serahTerima": sum(1 for k in in_proc if k["fase"] == "Serah Terima"),
        "targetBulanIni": sum(1 for k in in_proc if k.get("targetBuka") == m), "blocked": len(blocked),
        "perhatian": sum(1 for k in in_proc if k["status"] == "perhatian"), "lewatSla": sum(1 for k in in_proc if k["lewatSla"]),
        "lewatTarget": sum(1 for k in in_proc if k["lewatTarget"]), "bukaBulanIni": sum(1 for k in open_ if (k.get("openedAt") or "")[:7] == m),
        "wilayahAktif": None, "kandidat": sum(1 for k in act if k["stage"] == 0), "menungguApproval": sum(1 for k in act if k["stage"] == 1),
        "byStage": {str(i): sum(1 for k in approved if k["stage"] == i) for i in range(2, C.LAST_STAGE + 1)},
        "wilayahDalamProses": len({k["wilayahId"] for k in in_proc}),
    }


def headline(sm: Dict) -> str:
    if not sm["dalamProses"]:
        return "Belum ada kios approved yang sedang diproses Tim Ekspansi."
    t = f"Tim Ekspansi sedang memproses {sm['dalamProses']} kios di {sm['wilayahDalamProses']} wilayah; {sm['targetBulanIni']} kios ditargetkan buka {fmt_month(this_month())}"
    if sm["beroperasi"]:
        t += f", dan {sm['beroperasi']} kios telah beroperasi"
    t += "."
    if sm["blocked"]:
        t += f" Namun, {sm['blocked']} kios berstatus blocked dan membutuhkan dukungan divisi terkait."
    elif sm["lewatSla"]:
        t += f" Namun, {sm['lewatSla']} kios melewati SLA tahap dan perlu percepatan."
    return t


def report_kios(k: Dict) -> Dict:
    """Payload kios untuk All Divisi — tanpa data internal (sewa, DP, pemilik, komentar)."""
    keys = ["id", "kode", "nama", "wilayahNama", "cluster", "alamat", "stage", "stageName", "stagePic", "fase", "statusKey", "statusLabel",
            "nextStage", "nextPic", "targetBuka", "daysInStage", "lewatSla", "lewatTarget", "lastNote", "lastAt", "openedAt", "vendorNama", "renovasiPct"]
    return {x: k.get(x) for x in keys}


def weekly_text(ek: List[Dict], sm: Dict) -> str:
    act = [k for k in ek if k["status"] != "alternatif"]
    in_proc = [k for k in act if 2 <= k["stage"] < C.LAST_STAGE]
    lines = [f"WEEKLY UPDATE EKSPANSI CRK — {fmt_date_id()}", "",
             f"Kios beroperasi: {sm['beroperasi']} · Dalam proses: {sm['dalamProses']} · Target buka {fmt_month(this_month())}: {sm['targetBulanIni']}"]
    for f in ["Kontrak", "Renovasi", "Serah Terima"]:
        l = [k for k in in_proc if k["fase"] == f]
        if not l:
            continue
        lines += ["", f.upper()]
        for k in sorted(l, key=lambda x: -x["stage"]):
            extra = "" if k["status"] == "ontrack" else f" — {k['statusLabel']}"
            lines.append(f"• {k['nama']} ({k['wilayahNama']}) — {k['stageName']}, PIC {k['stagePic']}{extra}")
    blocked = [k for k in in_proc if k["status"] == "blocked"]
    if blocked:
        lines += ["", "BUTUH DUKUNGAN"]
        for k in blocked:
            lines.append(f"• {k['nama']}: {k['lastNote'] or 'blocked di ' + k['stageName']}")
    week_ago = (now() - timedelta(days=7)).isoformat()
    opened = [k for k in act if k["stage"] == C.LAST_STAGE and (k.get("openedAt") or "") >= week_ago[:10]]
    new = [k for k in act if (k.get("createdAt") or "") >= week_ago]
    lines += ["", f"Buka minggu ini: {', '.join(k['nama'] for k in opened) or '–'}", f"Masuk pipeline minggu ini: {', '.join(k['nama'] for k in new) or '–'}"]
    return "\n".join(lines)


@app.get("/api/report")
async def report(t: str = Query(""), ctx: Ctx = Depends(ctx_from_header)):
    s = await get_settings()
    if not ctx.member and (not t or not hmac.compare_digest(t, s["shareToken"])):
        err(404, "Link laporan tidak valid")
    st = await build_state()
    sm = summary(st["kios"])
    approved = [report_kios(k) for k in st["kios"] if k["status"] != "alternatif" and k["stage"] >= 2]
    return {"appName": s["appName"], "summary": sm, "headline": headline(sm), "kios": approved,
            "stages": [{"i": x["i"], "n": x["n"], "pic": x["pic"], "fase": x["fase"], "sla": (s.get("stageSla") or {}).get(str(x["i"]))} for x in C.STAGES if not x.get("internal")],
            "slaGroups": [{"nama": g[0], "stages": g[1], "hari": g[2]} for g in C.SLA_GROUPS],
            "weeklyText": s.get("lastWeeklyText") or weekly_text(st["kios"], sm), "weeklyAt": s.get("lastWeeklyAt", ""),
            "today": today(), "month": this_month(), "serverTime": iso()}


@app.get("/api/report/weekly-text", response_class=PlainTextResponse)
async def report_weekly(t: str = Query("")):
    s = await get_settings()
    if not t or not hmac.compare_digest(t, s["shareToken"]):
        err(404, "Link laporan tidak valid")
    st = await build_state()
    return weekly_text(st["kios"], summary(st["kios"]))


@app.get("/api/public-metrics")
async def public_metrics(key: str = Query("")):
    if not hmac.compare_digest(key, C.METRICS_API_KEY):
        err(401, "API key salah")
    st = await build_state()
    sm = summary(st["kios"])
    return {"operating": sm["beroperasi"], "inProcess": sm["dalamProses"], "byStage": sm["byStage"], "blocked": sm["blocked"],
            "openedThisMonth": sm["bukaBulanIni"], "targetThisMonth": sm["targetBulanIni"], "asOf": iso()}


# ---------------------------------------------------------------- admin: members, settings, export/import, jobs
class MemberUpd(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    active: Optional[bool] = None
    isAdmin: Optional[bool] = None


@app.put("/api/members/{mid}")
async def update_member(mid: str, body: MemberUpd, ctx: Ctx = Depends(require_admin)):
    m = await db.get("members", mid)
    if not m:
        err(404, "Anggota tidak ditemukan")
    f = {k: v for k, v in body.model_dump().items() if v is not None}
    if "role" in f and f["role"] not in C.ROLES:
        err(400, "Role tidak dikenal")
    await db.update("members", mid, f)
    return member_public(await db.get("members", mid))


class PinReset(BaseModel):
    pin: str = Field(min_length=4, max_length=6)


@app.post("/api/members/{mid}/reset-pin")
async def reset_pin(mid: str, body: PinReset, ctx: Ctx = Depends(require_admin)):
    if not body.pin.isdigit():
        err(400, "PIN harus angka")
    if not await db.update("members", mid, {"pinHash": hash_pin(body.pin)}):
        err(404, "Anggota tidak ditemukan")
    LOCK.pop(mid, None)
    return {"ok": True}


class SettingsIn(BaseModel):
    appName: Optional[str] = None
    weeklyUpdateDay: Optional[int] = None
    weeklyUpdateTime: Optional[str] = None
    dailyDigestTime: Optional[str] = None
    nudgeTime: Optional[str] = None
    workDays: Optional[List[int]] = None
    adminEmail: Optional[str] = None
    stalledDays: Optional[int] = None
    stageSla: Optional[Dict[str, int]] = None
    adminPin: Optional[str] = None
    regenerateShareToken: Optional[bool] = None


@app.put("/api/settings")
async def update_settings(body: SettingsIn, ctx: Ctx = Depends(require_admin)):
    s = await get_settings()
    d = body.model_dump(exclude_none=True)
    if "adminPin" in d:
        pin = d.pop("adminPin")
        if pin:
            if not (pin.isdigit() and 4 <= len(pin) <= 6):
                err(400, "PIN Admin harus angka 4–6 digit")
            s["adminPinHash"] = hash_pin(pin)
    if d.pop("regenerateShareToken", False):
        s["shareToken"] = secrets.token_urlsafe(18)
    import re as _re
    for key in ("weeklyUpdateTime", "dailyDigestTime", "nudgeTime"):
        if key in d and d[key] and not _re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", d[key]):
            err(400, f"Format jam {key} harus HH:MM (contoh 17:00)")
    if "weeklyUpdateDay" in d and not (1 <= int(d["weeklyUpdateDay"]) <= 7):
        err(400, "Hari Weekly Update harus 1 (Senin) sampai 7 (Minggu)")
    if "stalledDays" in d and int(d["stalledDays"]) < 1:
        err(400, "Batas 'tanpa update' minimal 1 hari")
    if "stageSla" in d:
        clean = {}
        for k, v in d["stageSla"].items():
            if not str(k).isdigit() or not (2 <= int(k) <= 13):
                continue
            if int(v) < 0:
                err(400, "SLA tidak boleh negatif")
            clean[str(int(k))] = int(v)
        d["stageSla"] = clean
    if "workDays" in d:
        d["workDays"] = sorted({int(x) for x in d["workDays"] if 1 <= int(x) <= 7}) or [1, 2, 3, 4, 5]
    s.update(d)
    await db.put("settings", s)
    return public_settings(s)


@app.get("/api/export.csv")
async def export_csv(ctx: Ctx = Depends(require_admin)):
    st = await build_state()
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf, delimiter=";")
    w.writerow(["kode", "nama", "wilayah", "cluster", "alamat", "tahap", "namaTahap", "pic", "status", "targetBuka", "sewaTahun", "dp", "rabNilai", "vendor", "hariDiTahap", "lewatSla", "catatanTerakhir", "updateTerakhir", "openedAt"])
    for k in st["kios"]:
        w.writerow([k["kode"], k["nama"], k["wilayahNama"], k["cluster"], k.get("alamat", ""), k["stage"], k["stageName"], k["stagePic"], k["statusLabel"], k.get("targetBuka", ""),
                    k.get("sewaTahun", 0), k.get("dp", 0), k.get("rabNilai", 0), k.get("vendorNama", ""), k["daysInStage"], "ya" if k["lewatSla"] else "", k["lastNote"], k["lastAt"], k.get("openedAt", "")])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=expansion-tracker.csv"})


STAGE_BY_NAME = {s["n"].lower(): s["i"] for s in C.STAGES}
STAGE_ALIASES = {"kandidat": 0, "approval": 1, "pengajuan dp": 2, "dp": 2, "legalitas": 3, "legal": 3, "sepakat spk": 4, "ttd spk": 5, "penandatanganan": 5,
                 "pelunasan": 6, "layouting": 7, "layout": 7, "rab": 8, "pembayaran vendor": 9, "mobilisasi": 10, "renovasi": 11, "serah terima renovasi": 12,
                 "serah terima operasional": 13, "beroperasi": 14, "buka": 14}


def parse_stage(v: str) -> int:
    v = (v or "").strip().lower()
    if v.isdigit():
        return max(0, min(C.LAST_STAGE, int(v)))
    if v in STAGE_BY_NAME:
        return STAGE_BY_NAME[v]
    for a, i in STAGE_ALIASES.items():
        if a in v:
            return i
    return 0


@app.post("/api/import")
async def import_csv(file: UploadFile = File(...), ctx: Ctx = Depends(require_admin)):
    """Impor dari spreadsheet lama. Kolom: nama, wilayah, kota, cluster, alamat, tahap, status, targetBuka, sewaTahun, dp, vendor, catatan, tanggalUpdate."""
    raw = (await file.read()).decode("utf-8-sig", errors="ignore")
    sample = raw[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    rows = list(csv.DictReader(io.StringIO(raw), delimiter=delim))
    wil = {w["nama"].strip().lower(): w for w in await db.find("wilayah")}
    kios = await db.find("kios")
    existing = {(k["nama"].strip().lower(), k["wilayahId"]) for k in kios}
    n_w = n_k = 0
    for r in rows:
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        wn = r.get("wilayah") or "Tanpa wilayah"
        w = wil.get(wn.lower())
        if not w:
            cluster = r.get("cluster") if r.get("cluster") in C.CLUSTERS else "Lainnya"
            w = {"id": nid(), "nama": wn, "kota": r.get("kota", ""), "cluster": cluster, "spvId": "", "surveyorId": "", "status": "cari", "targetKios": 1,
                 "targetBulan": "", "catatan": "Import spreadsheet", "visitDate": "", "visitNotes": "", "photos": [], "createdAt": iso(), "updatedAt": iso(), "updatedBy": ctx.member["id"]}
            await db.put("wilayah", w)
            wil[wn.lower()] = w
            n_w += 1
        if not r.get("nama") or (r["nama"].lower(), w["id"]) in existing:
            continue
        stage = parse_stage(r.get("tahap", ""))
        status = r.get("status", "ontrack").lower()
        status = {"on track": "ontrack", "ontrack": "ontrack", "perlu perhatian": "perhatian", "perhatian": "perhatian", "blocked": "blocked", "alternatif": "alternatif", "ditolak": "alternatif"}.get(status, "ontrack")

        def num(x):
            try:
                return float(str(x).replace(".", "").replace(",", ".").replace("rp", "").strip() or 0)
            except Exception:
                return 0
        upd = r.get("tanggalupdate") or today()
        try:
            upd_iso = datetime.strptime(upd[:10], "%Y-%m-%d").replace(tzinfo=C.TZ).isoformat(timespec="seconds")
        except Exception:
            upd_iso = iso()
        k = {"id": nid(), "kode": await next_code(w["cluster"]), "nama": r["nama"], "wilayahId": w["id"], "alamat": r.get("alamat", ""), "mapsUrl": "",
             "targetBuka": r.get("targetbuka", "")[:7], "luas": 0, "sewaTahun": num(r.get("sewatahun")), "dp": num(r.get("dp")), "pemilikNama": "", "pemilikHp": "",
             "vendorNama": r.get("vendor", ""), "rabNilai": num(r.get("rab")), "renovasiPct": 0, "catatan": r.get("catatan", ""), "stage": stage, "status": status,
             "spkFile": "", "photos": [], "openedAt": upd_iso[:10] if stage == C.LAST_STAGE else "", "createdAt": upd_iso, "createdBy": ctx.member["id"], "updatedAt": upd_iso, "updatedBy": ctx.member["id"]}
        await db.put("kios", k)
        await db.put("stagelog", {"id": nid(), "kiosId": k["id"], "at": upd_iso, "byId": ctx.member["id"], "fromStage": -1, "toStage": stage, "fromStatus": "", "toStatus": status, "note": "Import dari spreadsheet"})
        existing.add((r["nama"].lower(), w["id"]))
        n_k += 1
    for w in wil.values():
        await sync_wilayah_status(w["id"])
    return {"wilayahBaru": n_w, "kiosBaru": n_k, "barisDibaca": len(rows)}


async def ensure_team() -> int:
    """Tambahkan anggota tim ekspansi dari config.TEAM yang belum ada (cocokkan email/nama)."""
    members = await db.find("members")
    have = {(m.get("email") or "").lower() for m in members} | {m["name"].lower() for m in members}
    n = 0
    for name, email, role in C.TEAM:
        if email.lower() in have or name.lower() in have:
            continue
        await db.put("members", {"id": nid(), "name": name, "role": role, "email": email, "phone": "", "pinHash": "",
                                 "active": True, "isAdmin": role in C.FULL_ACCESS_ROLES, "createdAt": iso(), "preset": True})
        n += 1
    return n


@app.post("/api/team/preset")
async def team_preset(ctx: Ctx = Depends(require_admin)):
    return {"ditambahkan": await ensure_team()}


@app.post("/api/seed")
async def seed(ctx: Ctx = Depends(require_admin)):
    if await db.count("kios"):
        err(400, "Data contoh hanya bisa diisi saat database kosong")
    from .seed import seed_data
    return await seed_data(db, ctx.member["id"])


# ---------------------------------------------------------------- jobs
async def job_digest(force=False):
    s = await get_settings()
    if not force and not await slot_due("digest", s["dailyDigestTime"], s):
        return {"skipped": True}
    st = await build_state()
    ek = st["kios"]
    sm = summary(ek)
    moved = [k for k in ek if (k["lastAt"] or "")[:10] == today()]
    blocked = [k for k in ek if k["statusKey"] == "blocked"]
    late = [k for k in ek if k["lewatSla"] or k["stalled"]]
    wait = [k for k in ek if k["stage"] == 1 and k["status"] != "alternatif"]
    html = f"<h2>Daily Digest Ekspansi — {fmt_date_id()}</h2><p>{headline(sm)}</p>"
    html += "<h3>Bergerak hari ini</h3>" + mailer.ul([f"{k['nama']} → {k['stageName']} ({k['lastNote']})" for k in moved])
    html += "<h3>Blocked</h3>" + mailer.ul([f"{k['nama']} — {k['stageName']}: {k['lastNote']}" for k in blocked])
    html += "<h3>Lewat SLA / tidak ada update</h3>" + mailer.ul([f"{k['nama']} — {k['stageName']} ({k['daysInStage']} hari, PIC {k['stagePic']})" for k in late])
    html += "<h3>Menunggu approval SPV</h3>" + mailer.ul([f"{k['nama']} ({k['wilayahNama']})" for k in wait])
    rcpt = [m["email"] for m in st["members"] if m.get("email") and (m["role"] in ("Manager", "SPV", "Admin") or m.get("isAdmin"))]
    if s.get("adminEmail"):
        rcpt.append(s["adminEmail"])
    sent = await mailer.send_many(rcpt, "Daily Digest Ekspansi CRK", html)
    await db.put("reminderlog", {"id": nid(), "date": today(), "slot": "digest", "sentAt": iso(), "recipients": rcpt, "count": sent})
    return {"sent": sent, "recipients": rcpt}


async def job_nudge(force=False):
    s = await get_settings()
    if not force and not await slot_due("nudge", s["nudgeTime"], s):
        return {"skipped": True}
    st = await build_state()
    late = [k for k in st["kios"] if k["lewatSla"] or k["stalled"]]
    sent = 0
    rcpt = []
    for m in st["members"]:
        if not m.get("email") or not m.get("active", True):
            continue
        mine = [k for k in late if m["role"] in C.STAGES[k["stage"]]["roles"] or m["role"] in ("SPV", "Manager")]
        if not mine:
            continue
        html = f"<p>Halo {m['name']}, {len(mine)} kios menunggu Anda:</p>" + mailer.ul([f"{k['nama']} — {k['stageName']} ({k['daysInStage']} hari di tahap ini)" for k in mine]) + f"<p><a href='{C.PUBLIC_BASE_URL}'>Buka Expansion Tracker</a></p>"
        sent += await mailer.send(m["email"], f"{len(mine)} kios menunggu Anda — Expansion Tracker", html)
        rcpt.append(m["email"])
    await db.put("reminderlog", {"id": nid(), "date": today(), "slot": "nudge", "sentAt": iso(), "recipients": rcpt, "count": sent})
    return {"sent": sent, "recipients": rcpt}


async def job_weekly(force=False):
    s = await get_settings()
    if not force:
        if now().isoweekday() != int(s.get("weeklyUpdateDay") or 1) or not await slot_due("weekly", s["weeklyUpdateTime"], s, ignore_workday=True):
            return {"skipped": True}
    st = await build_state()
    text = weekly_text(st["kios"], summary(st["kios"]))
    s["lastWeeklyText"] = text
    s["lastWeeklyAt"] = iso()
    await db.put("settings", s)
    rcpt = [m["email"] for m in st["members"] if m.get("email") and m.get("active", True)]
    if s.get("adminEmail"):
        rcpt.append(s["adminEmail"])
    html = "<pre style='font-family:inherit;white-space:pre-wrap'>" + text.replace("<", "&lt;") + "</pre>"
    sent = await mailer.send_many(rcpt, "Weekly Update Ekspansi CRK", html)
    await db.put("reminderlog", {"id": nid(), "date": today(), "slot": "weekly", "sentAt": iso(), "recipients": rcpt, "count": sent})
    return {"sent": sent, "text": text}


async def job_backup(force=False):
    if not force and not (now().isoweekday() == 7 and now().hour == 2 and await slot_due("backup", "02:00", await get_settings(), ignore_workday=True)):
        return {"skipped": True}
    os.makedirs(C.BACKUP_DIR, exist_ok=True)
    path = os.path.join(C.BACKUP_DIR, f"backup-{now().strftime('%Y%m%d-%H%M')}.json")
    data = await db.dump()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    files = sorted(f for f in os.listdir(C.BACKUP_DIR) if f.startswith("backup-"))
    for old in files[:-8]:
        os.remove(os.path.join(C.BACKUP_DIR, old))
    await db.put("reminderlog", {"id": nid(), "date": today(), "slot": "backup", "sentAt": iso(), "recipients": [], "count": 1})
    return {"file": os.path.basename(path), "kept": min(len(files), 8)}


async def slot_due(slot: str, hhmm: str, s: Dict, ignore_workday=False) -> bool:
    if not hhmm:
        return False
    if not ignore_workday and now().isoweekday() not in (s.get("workDays") or [1, 2, 3, 4, 5]):
        return False
    try:
        h, m = [int(x) for x in hhmm.split(":")]
    except Exception:
        return False
    if (now().hour, now().minute) < (h, m):
        return False
    done = await db.find("reminderlog", {"date": today(), "slot": slot})
    return not done


JOBS = {"digest": job_digest, "nudge": job_nudge, "weekly": job_weekly, "backup": job_backup}


async def tick():
    for name, fn in JOBS.items():
        try:
            await fn()
        except Exception as e:
            log.exception("job %s gagal: %s", name, e)


@app.post("/api/jobs/{name}/run")
async def run_job(name: str, ctx: Ctx = Depends(require_admin)):
    if name not in JOBS:
        err(404, "Job tidak dikenal")
    return await JOBS[name](force=True)


@app.get("/api/backups")
async def list_backups(ctx: Ctx = Depends(require_admin)):
    if not os.path.isdir(C.BACKUP_DIR):
        return []
    return sorted(os.listdir(C.BACKUP_DIR), reverse=True)


@app.get("/api/backups/{name}")
async def get_backup(name: str, ctx: Ctx = Depends(require_admin)):
    p = os.path.join(C.BACKUP_DIR, os.path.basename(name))
    if not os.path.exists(p):
        err(404, "Backup tidak ditemukan")
    return FileResponse(p, filename=os.path.basename(p))


# ---------------------------------------------------------------- health & static
@app.get("/api/health")
async def health():
    try:
        ok = await asyncio.wait_for(db.ping(), timeout=5)
    except Exception:
        ok = False
    mode = "mock" if C.USE_MOCK_DB or not C.MONGO_URL else ("mongo" if ok else "mongo-unreachable")
    return JSONResponse({"ok": ok, "db": mode, "port": os.getenv("PORT", "8080"), "time": iso()}, status_code=200 if ok else 503)


@app.on_event("startup")
async def startup():
    for k, v, d in (("SECRET_KEY", C.SECRET_KEY, "change-me-secret"), ("DEFAULT_ADMIN_PIN", C.DEFAULT_ADMIN_PIN, "1234"), ("METRICS_API_KEY", C.METRICS_API_KEY, "change-me-metrics")):
        if v == d:
            log.warning("%s masih nilai bawaan — ganti di environment Railway sebelum go-live", k)
    if C.USE_MOCK_DB or not C.MONGO_URL:
        log.warning("USE_MOCK_DB aktif: data disimpan di %s (tambahkan MongoDB di Railway untuk produksi)", os.path.join(C.DATA_DIR, "mock.json"))
    else:
        try:
            await db.ensure_indexes()
        except Exception as e:
            log.warning("Index Mongo gagal dibuat: %s", e)
    try:
        await asyncio.wait_for(get_settings(), timeout=15)
        n = await ensure_team()
        if n:
            log.info("Tim ekspansi dari dokumen Flow Ekspansi ditambahkan: %d anggota (PIN dibuat saat login pertama)", n)
    except Exception as e:
        log.error("Database belum bisa dijangkau saat startup (%s). App tetap berjalan; cek MONGO_URL. /api/health akan melaporkan status DB.", e)
    if os.getenv("DISABLE_SCHEDULER", "") != "1":
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        sch = AsyncIOScheduler(timezone=str(C.TZ))
        sch.add_job(tick, "interval", minutes=15, next_run_time=now() + timedelta(seconds=30))
        sch.start()
        app.state.scheduler = sch


def _asset_version() -> str:
    try:
        return str(int(max(os.path.getmtime(os.path.join(FRONTEND, f)) for f in ("app.js", "style.css"))))
    except Exception:
        return "1"


def _index_html() -> HTMLResponse:
    with open(os.path.join(FRONTEND, "index.html"), encoding="utf-8") as f:
        html = f.read()
    v = _asset_version()
    html = html.replace("/static/app.js", f"/static/app.js?v={v}").replace("/static/style.css", f"/static/style.css?v={v}")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


@app.get("/", response_class=HTMLResponse)
async def index():
    return _index_html()


@app.get("/laporan", response_class=HTMLResponse)
async def laporan_page():
    return _index_html()


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
