"""Acceptance tests — jalankan: pytest -q (memakai mock DB di folder sementara)."""
import os, sys, tempfile, io
os.environ["USE_MOCK_DB"] = "true"
os.environ["DISABLE_SCHEDULER"] = "1"
os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["SECRET_KEY"] = "test-secret"
os.environ["METRICS_API_KEY"] = "mkey"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from backend.main import app, db, C




@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def cl():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


T = {}


def H(name):
    return {"Authorization": "Bearer " + T[name]}


async def test_register_roles(cl):
    r = await cl.post("/api/auth/register", json={"name": "Dimas", "role": "SPV", "pin": "1234", "email": "dimas@x.id"})
    assert r.status_code == 200, r.text
    T["dimas"] = r.json()["token"]
    assert r.json()["member"]["isAdmin"] is True  # pendaftar pertama = Admin
    for n, role in (("Rani", "Surveyor"), ("Bayu", "SDO"), ("Lia", "Legal"), ("Fina", "Finance")):
        r = await cl.post("/api/auth/register", json={"name": n, "role": role, "pin": "1234"})
        assert r.status_code == 200, r.text
        T[n.lower()] = r.json()["token"]
        assert r.json()["member"]["isAdmin"] is False
    r = await cl.post("/api/auth/register", json={"name": "Rani", "role": "Surveyor", "pin": "9999"})
    assert r.status_code == 400
    r = await cl.post("/api/auth/register", json={"name": "Ani", "role": "Surveyor", "pin": "12", "phone": "0812"})
    assert r.status_code == 422


async def test_login_lock(cl):
    members = (await cl.get("/api/auth/members")).json()
    rani = next(m for m in members if m["name"] == "Rani")
    for i in range(5):
        r = await cl.post("/api/auth/login", json={"memberId": rani["id"], "pin": "0000"})
    assert r.status_code == 423
    r = await cl.post("/api/auth/login", json={"memberId": rani["id"], "pin": "1234"})
    assert r.status_code == 423  # masih terkunci
    r = await cl.post(f"/api/members/{rani['id']}/reset-pin", json={"pin": "4321"}, headers=H("dimas"))
    assert r.status_code == 200
    r = await cl.post("/api/auth/login", json={"memberId": rani["id"], "pin": "4321"})
    assert r.status_code == 200
    T["rani"] = r.json()["token"]


async def test_wilayah_kios_flow(cl):
    r = await cl.post("/api/wilayah", json={"nama": "Jatiasih–Pekayon", "kota": "Bekasi", "cluster": "Jabodetabek", "targetKios": 1}, headers=H("rani"))
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    T["wid"] = wid
    r = await cl.post("/api/kios", json={"nama": "Ruko Jatiasih B2", "wilayahId": wid}, headers=H("rani"))
    assert r.status_code == 200, r.text
    k = r.json()
    assert k["kode"] == "JBD-001" and k["stage"] == 0
    T["kid"] = k["id"]
    # Surveyor memajukan 0→1 (PIC Surveyor) boleh
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 1}, headers=H("rani"))
    assert r.status_code == 200, r.text
    # Surveyor tidak boleh approve (PIC SPV)
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 2}, headers=H("rani"))
    assert r.status_code == 403
    # SPV approve tapi DP kosong → gate
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 2}, headers=H("dimas"))
    assert r.status_code == 400 and "DP" in r.json()["detail"]
    r = await cl.put(f"/api/kios/{k['id']}", json={"nama": "Ruko Jatiasih B2", "wilayahId": wid, "dp": 10000000, "sewaTahun": 45000000}, headers=H("dimas"))
    assert r.status_code == 200
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 2}, headers=H("dimas"))
    assert r.status_code == 200
    # wilayah otomatis selesai
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    w = next(x for x in st["wilayah"] if x["id"] == wid)
    assert w["status"] == "selesai"
    # Finance boleh memajukan Pengajuan DP (2→3)
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 3}, headers=H("fina"))
    assert r.status_code == 200
    # Legal boleh memajukan Legalitas (3→4); SDO tidak
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 4}, headers=H("bayu"))
    assert r.status_code == 403
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 4}, headers=H("lia"))
    assert r.status_code == 200
    # 4→5 boleh tanpa file; 5→6 butuh SPK yang sudah ditandatangani
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 5}, headers=H("rani"))
    assert r.status_code == 200
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 6}, headers=H("dimas"))
    assert r.status_code == 400 and "SPK" in r.json()["detail"]
    r = await cl.post(f"/api/kios/{k['id']}/files?kind=spk", files={"file": ("spk.pdf", b"%PDF-1.4 test", "application/pdf")}, headers=H("rani"))
    assert r.status_code == 200
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 6}, headers=H("dimas"))
    assert r.status_code == 200
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 5, "note": "kembali untuk uji"}, headers=H("dimas"))
    assert r.status_code == 200
    # lompat tahap oleh non-admin ditolak
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 8, "note": "x"}, headers=H("rani"))
    assert r.status_code == 400
    # kembali tahap oleh surveyor ditolak, oleh SPV tanpa catatan ditolak, dengan catatan ok
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 4}, headers=H("rani"))
    assert r.status_code == 403
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 4}, headers=H("dimas"))
    assert r.status_code == 400
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 4, "note": "SPK direvisi pemilik"}, headers=H("dimas"))
    assert r.status_code == 200


async def test_status_requires_note(cl):
    kid = T["kid"]
    r = await cl.post(f"/api/kios/{kid}/status", json={"status": "blocked"}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/kios/{kid}/status", json={"status": "blocked", "note": "Sertifikat atas nama pihak ketiga"}, headers=H("rani"))
    assert r.status_code == 200
    tl = (await cl.get(f"/api/kios/{kid}/timeline", headers=H("rani"))).json()
    assert tl[0]["note"].startswith("Sertifikat")


async def test_report_public_and_privacy(cl):
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    tok = st["settings"]["shareToken"]
    assert "shareToken" not in (await cl.get("/api/state", headers=H("rani"))).json()["settings"]
    r = await cl.get("/api/report?t=salah")
    assert r.status_code == 404
    r = await cl.get(f"/api/report?t={tok}")
    assert r.status_code == 200
    rep = r.json()
    assert rep["summary"]["blocked"] == 1 and rep["summary"]["dalamProses"] == 1
    k = rep["kios"][0]
    for forbidden in ("sewaTahun", "dp", "pemilikHp", "pemilikNama"):
        assert forbidden not in k
    assert "Namun" in rep["headline"]
    assert "WEEKLY UPDATE EKSPANSI CRK" in rep["weeklyText"] and "BUTUH DUKUNGAN" in rep["weeklyText"]
    # kios kandidat (stage<2) tidak muncul di laporan
    r = await cl.post("/api/kios", json={"nama": "Kandidat X", "wilayahId": T["wid"]}, headers=H("rani"))
    assert r.json()["kode"] == "JBD-002"
    rep = (await cl.get(f"/api/report?t={tok}")).json()
    assert all(x["nama"] != "Kandidat X" for x in rep["kios"])


async def test_alternatif_and_reopen(cl):
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    kx = next(k for k in st["kios"] if k["nama"] == "Kandidat X")
    r = await cl.post(f"/api/kios/{kx['id']}/alternatif", json={"note": ""}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/kios/{kx['id']}/alternatif", json={"note": "Footfall rendah"}, headers=H("rani"))
    assert r.json()["status"] == "alternatif"
    r = await cl.post(f"/api/kios/{kx['id']}/stage", json={"to": 1}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/kios/{kx['id']}/alternatif", json={"note": "coba lagi"}, headers=H("rani"))
    assert r.json()["status"] == "ontrack" and r.json()["stage"] == 0


async def test_metrics_settings_jobs(cl):
    r = await cl.get("/api/public-metrics?key=salah")
    assert r.status_code == 401
    r = await cl.get("/api/public-metrics?key=mkey")
    assert r.status_code == 200 and r.json()["inProcess"] == 1
    r = await cl.put("/api/settings", json={"stageSla": {"4": 1}, "adminPin": "5678"}, headers=H("rani"))
    assert r.status_code == 403
    r = await cl.put("/api/settings", json={"stageSla": {"4": 0}, "adminPin": "5678"}, headers=H("dimas"))
    assert r.status_code == 200
    r = await cl.post("/api/auth/admin-login", json={"pin": "5678"})
    assert r.status_code == 200
    T["adm"] = r.json()["token"]
    for j in ("digest", "nudge", "weekly", "backup"):
        r = await cl.post(f"/api/jobs/{j}/run", headers=H("adm"))
        assert r.status_code == 200, r.text
    r = await cl.post("/api/jobs/weekly/run", headers=H("rani"))
    assert r.status_code == 403
    r = await cl.get("/api/export.csv", headers=H("dimas"))
    assert r.status_code == 200 and "JBD-001" in r.text
    r = await cl.get("/api/backups", headers=H("adm"))
    assert len(r.json()) == 1


async def test_import_csv(cl):
    csv_text = "nama;wilayah;kota;cluster;tahap;status;targetBuka;sewaTahun;dp;vendor;catatan;tanggalUpdate\n" \
               "Kios MERR;MERR–Rungkut;Surabaya;Jawa Timur;Renovasi Kios;On track;2026-12;42.000.000;10.000.000;UD Jaya;impor;2026-11-01\n" \
               "Kios MERR;MERR–Rungkut;Surabaya;Jawa Timur;Renovasi Kios;On track;2026-12;;;;dupe;2026-11-01\n"
    r = await cl.post("/api/import", files={"file": ("lama.csv", csv_text.encode("utf-8"), "text/csv")}, headers=H("dimas"))
    assert r.status_code == 200, r.text
    assert r.json() == {"wilayahBaru": 1, "kiosBaru": 1, "barisDibaca": 2}
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    k = next(x for x in st["kios"] if x["nama"] == "Kios MERR")
    assert k["kode"] == "JTM-001" and k["stage"] == 11 and k["sewaTahun"] == 42000000


async def test_health_and_pages(cl):
    r = await cl.get("/api/health")
    assert r.json()["ok"] and r.json()["db"] == "mock"
    assert (await cl.get("/")).status_code == 200
    assert (await cl.get("/laporan")).status_code == 200
    assert (await cl.get("/static/app.js")).status_code == 200


async def test_preset_team_and_first_login_pin(cl):
    r = await cl.post("/api/team/preset", headers=H("dimas"))
    assert r.status_code == 200 and r.json()["ditambahkan"] == 10
    members = (await cl.get("/api/auth/members")).json()
    bram = next(m for m in members if m["name"] == "Bram")
    assert bram["hasPin"] is False and bram["role"] == "Manager"
    r = await cl.post("/api/auth/login", json={"memberId": bram["id"], "pin": "12"})
    assert r.status_code == 400
    r = await cl.post("/api/auth/login", json={"memberId": bram["id"], "pin": "246810"})
    assert r.status_code == 200 and r.json()["pinCreated"] is True
    tok = r.json()["token"]
    r = await cl.post("/api/auth/login", json={"memberId": bram["id"], "pin": "000000"})
    assert r.status_code == 401
    # Manager = akses penuh: bisa ubah settings dan lihat shareToken
    st = (await cl.get("/api/state", headers={"Authorization": "Bearer " + tok})).json()
    assert st["me"]["isAdmin"] is True and "shareToken" in st["settings"]
    assert st["settings"]["slaVersion"] == 2  # stageSla sudah diubah test sebelumnya
    r = await cl.post("/api/team/preset", headers=H("dimas"))
    assert r.json()["ditambahkan"] == 0


async def test_status_reset_on_advance_and_days_in_stage(cl):
    kid = T["kid"]
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    k = next(x for x in st["kios"] if x["id"] == kid)
    assert k["statusKey"] == "blocked" and k["stage"] == 4
    # perubahan status tidak mereset hari di tahap: log masuk tahap tetap yang dipakai
    r = await cl.post(f"/api/kios/{kid}/status", json={"status": "perhatian", "note": "cek ulang"}, headers=H("rani"))
    assert r.status_code == 200
    # maju tahap → status otomatis On Track
    r = await cl.post(f"/api/kios/{kid}/stage", json={"to": 5}, headers=H("rani"))
    assert r.status_code == 200 and r.json()["status"] == "ontrack"
    tl = (await cl.get(f"/api/kios/{kid}/timeline", headers=H("rani"))).json()
    assert tl[0]["toStage"] == 5 and tl[0]["toStatus"] == "ontrack" and tl[0]["fromStatus"] == "perhatian"


async def test_wilayah_back_to_cari_when_kios_alternatif(cl):
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    w = next(x for x in st["wilayah"] if x["id"] == T["wid"])
    assert w["status"] == "selesai"
    r = await cl.post(f"/api/kios/{T['kid']}/alternatif", json={"note": "pemilik batal"}, headers=H("dimas"))
    assert r.json()["status"] == "alternatif"
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    w = next(x for x in st["wilayah"] if x["id"] == T["wid"])
    assert w["status"] == "cari"
    r = await cl.post(f"/api/kios/{T['kid']}/alternatif", json={"note": "lanjut lagi"}, headers=H("dimas"))
    assert r.json()["stage"] == 0


async def test_settings_sla_validation(cl):
    r = await cl.put("/api/settings", json={"stageSla": {"2": 2, "11": 12, "99": 5}, "weeklyUpdateTime": "08:30"}, headers=H("dimas"))
    assert r.status_code == 200
    assert r.json()["stageSla"] == {"2": 2, "11": 12}
    r = await cl.put("/api/settings", json={"weeklyUpdateTime": "8.30"}, headers=H("dimas"))
    assert r.status_code == 400
    r = await cl.put("/api/settings", json={"weeklyUpdateDay": 0}, headers=H("dimas"))
    assert r.status_code == 400
    r = await cl.put("/api/settings", json={"stageSla": {"3": -1}}, headers=H("dimas"))
    assert r.status_code == 400
    # SLA baru langsung memengaruhi flag: kios di stage 5 selama 0 hari, SLA 0 = tidak ada flag
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    assert st["settings"]["stageSla"]["11"] == 12


async def test_direksi_report(cl):
    r = await cl.get("/api/direksi?t=salah")
    assert r.status_code == 404
    r = await cl.put("/api/settings", json={"monthlyTarget": {"2026-12": 2, "abc": 1, "2027-01": -3}}, headers=H("dimas"))
    assert r.status_code == 200 and r.json()["monthlyTarget"] == {"2026-12": 2}
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    r = await cl.get("/api/direksi?t=" + st["settings"]["shareToken"])
    assert r.status_code == 200
    d = r.json()
    assert len(d["monthly"]) == 9 and sum(1 for m in d["monthly"] if m["isCurrent"]) == 1
    assert {f["fase"] for f in d["fases"]} == {"Kontrak", "Renovasi", "Serah Terima"}
    assert len(d["stageSpeed"]) == 12 and len(d["highlights"]) >= 3
    k = (d["attention"] + d["upcoming"] + [{}])[0]
    for forbidden in ("sewaTahun", "dp", "pemilikHp"):
        assert forbidden not in k
    assert (await cl.get("/direksi")).status_code == 200


async def test_wilayah_photo_required(cl):
    r = await cl.post("/api/wilayah", json={"nama": "Cimahi Tengah", "kota": "Cimahi", "cluster": "Bandung Raya", "status": "visit", "visitDate": "2026-11-12"}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post("/api/wilayah", json={"nama": "Cimahi Tengah", "kota": "Cimahi", "cluster": "Bandung Raya"}, headers=H("rani"))
    assert r.status_code == 200
    wid = r.json()["id"]
    base = {"nama": "Cimahi Tengah", "kota": "Cimahi", "cluster": "Bandung Raya", "status": "visit", "visitDate": "2026-11-12"}
    r = await cl.put(f"/api/wilayah/{wid}", json=base, headers=H("rani"))
    assert r.status_code == 400 and "foto" in r.json()["detail"].lower()
    r = await cl.post(f"/api/wilayah/{wid}/files", files={"file": ("x.txt", b"bukan gambar", "text/plain")}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/wilayah/{wid}/files", files={"file": ("visit.jpg", b"\xff\xd8\xff\xe0fake", "image/jpeg")}, headers=H("rani"))
    assert r.status_code == 200
    fid = r.json()["id"]
    r = await cl.put(f"/api/wilayah/{wid}", json={**base, "visitDate": ""}, headers=H("rani"))
    assert r.status_code == 400 and "tanggal" in r.json()["detail"].lower()
    r = await cl.put(f"/api/wilayah/{wid}", json=base, headers=H("rani"))
    assert r.status_code == 200 and r.json()["status"] == "visit" and len(r.json()["photos"]) == 1
    # foto terakhir tidak boleh dihapus saat status visit
    r = await cl.delete(f"/api/wilayah/{wid}/files/{fid}", headers=H("rani"))
    assert r.status_code == 400
    assert (await cl.get(f"/api/files/{fid}")).status_code == 200


async def test_tindak_lanjut(cl):
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    k = next(x for x in st["kios"] if x["nama"] == "Kios MERR")  # stage 11 dari import
    wid = k["wilayahId"]
    r = await cl.post(f"/api/kios/{k['id']}/tindak", json={"tindak": "hold"}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/kios/{k['id']}/tindak", json={"tindak": "hold", "note": "vendor menunggu material"}, headers=H("rani"))
    assert r.status_code == 200 and r.json()["tindak"] == "hold"
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 12}, headers=H("bayu"))
    assert r.status_code == 400 and "Hold" in r.json()["detail"]
    st = (await cl.get("/api/state", headers=H("dimas"))).json()
    e = next(x for x in st["kios"] if x["id"] == k["id"])
    assert e["statusKey"] == "hold" and e["lewatSla"] is False
    tok = st["settings"]["shareToken"]
    rep = (await cl.get(f"/api/report?t={tok}")).json()
    assert any(x["id"] == k["id"] and x["tindak"] == "hold" for x in rep["kios"])
    assert "HOLD" in (await cl.get(f"/api/report/weekly-text?t={tok}")).text
    r = await cl.post(f"/api/kios/{k['id']}/tindak", json={"tindak": "skip", "note": "lokasi dibatalkan pemilik"}, headers=H("dimas"))
    assert r.status_code == 200
    rep = (await cl.get(f"/api/report?t={tok}")).json()
    assert all(x["id"] != k["id"] for x in rep["kios"]) and rep["summary"]["skip"] >= 1
    r = await cl.post(f"/api/kios/{k['id']}/tindak", json={"tindak": "followup"}, headers=H("dimas"))
    assert r.status_code == 200 and r.json()["tindak"] == "followup"
    r = await cl.post(f"/api/kios/{k['id']}/stage", json={"to": 12}, headers=H("bayu"))
    assert r.status_code == 200
    # wilayah
    r = await cl.post(f"/api/wilayah/{wid}/tindak", json={"tindak": "skip"}, headers=H("rani"))
    assert r.status_code == 400
    r = await cl.post(f"/api/wilayah/{wid}/tindak", json={"tindak": "hold", "note": "tunggu budget Q1"}, headers=H("rani"))
    assert r.status_code == 200 and r.json()["tindak"] == "hold" and "Hold" in r.json()["catatan"]
