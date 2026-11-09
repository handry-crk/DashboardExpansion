"""Data contoh (*ilustrasi) dari rencana titik ekspansi 2027 — hanya untuk database kosong."""
import uuid
from datetime import timedelta
from . import config as C


def _iso(dt):
    return dt.isoformat(timespec="seconds")


async def seed_data(db, by: str):
    from .main import now, today, next_code, add_log
    n = now()
    W = [
        ("Jatiasih–Pekayon", "Bekasi", "Jabodetabek", "selesai", "Kios J1 sudah approved"),
        ("Cibubur–Harjamukti", "Depok/Bogor", "Jabodetabek", "cari", "2 kandidat dekat LRT Harjamukti"),
        ("Cikarang Lippo–Jababeka", "Bekasi", "Jabodetabek", "dibagi", "Cadangan bila Cibubur tidak layak"),
        ("Jatinangor–Cipacing", "Sumedang", "Bandung Raya", "selesai", ""),
        ("Cimahi Tengah", "Cimahi", "Bandung Raya", "visit", "Visit 12 Nov"),
        ("MERR–Rungkut", "Surabaya", "Jawa Timur", "selesai", "Pilot kota baru"),
    ]
    wid = {}
    for nama, kota, cl, st, cat in W:
        w = {"id": uuid.uuid4().hex[:12], "nama": nama, "kota": kota, "cluster": cl, "spvId": "", "surveyorId": "", "status": st, "targetKios": 1,
             "targetBulan": "", "catatan": f"*Data ilustrasi. {cat}".strip(), "visitDate": "", "visitNotes": "", "photos": [],
             "createdAt": _iso(n - timedelta(days=20)), "updatedAt": _iso(n - timedelta(days=2)), "updatedBy": by}
        await db.put("wilayah", w)
        wid[nama] = w["id"]
    K = [
        # nama, wilayah, stage, status, target, sewa, dp, rab, vendor, hari di tahap, catatan terakhir
        ("Ruko Jatiasih Blok B2", "Jatiasih–Pekayon", 5, "ontrack", "2027-02", 45e6, 10e6, 0, "CV Karya Interior", 2, "SPK dicek Legal, tanda tangan pemilik dijadwalkan Rabu"),
        ("Kios Pekayon Jaya", "Jatiasih–Pekayon", 3, "blocked", "2027-03", 40e6, 10e6, 0, "", 9, "Sertifikat atas nama pihak ketiga, menunggu opini Legal"),
        ("Ruko Harjamukti LRT", "Cibubur–Harjamukti", 1, "ontrack", "2027-05", 55e6, 0, 0, "", 1, "Kandidat utama, menunggu approval SPV"),
        ("Kios Ciangsana Raya", "Cibubur–Harjamukti", 0, "alternatif", "", 30e6, 0, 0, "", 1, "Footfall rendah, dijadikan alternatif"),
        ("Kios Jatinangor Town Square", "Jatinangor–Cipacing", 8, "perhatian", "2027-02", 38e6, 9.5e6, 62e6, "CV Karya Interior", 6, "RAB vendor di atas budget 15%, nego ulang"),
        ("Kios MERR Rungkut Madya", "MERR–Rungkut", 11, "ontrack", "2026-12", 42e6, 10e6, 58e6, "UD Jaya Kontraktor", 12, "Renovasi 60%, target serah terima 10 Des"),
    ]
    for nama, wn, stage, status, target, sewa, dp, rab, vendor, days, note in K:
        w = await db.get("wilayah", wid[wn])
        k = {"id": uuid.uuid4().hex[:12], "kode": await next_code(w["cluster"]), "nama": nama, "wilayahId": w["id"], "alamat": "*Alamat ilustrasi", "mapsUrl": "",
             "targetBuka": target, "luas": 0, "sewaTahun": sewa, "dp": dp, "pemilikNama": "", "pemilikHp": "", "vendorNama": vendor, "rabNilai": rab,
             "renovasiPct": 60 if stage == 11 else 0, "catatan": "*Data ilustrasi", "stage": stage, "status": status, "spkFile": "/api/files/contoh" if stage >= 5 else "",
             "photos": [], "openedAt": "", "createdAt": _iso(n - timedelta(days=days + 20)), "createdBy": by, "updatedAt": _iso(n - timedelta(days=min(days, 3))), "updatedBy": by}
        await db.put("kios", k)
        await db.put("stagelog", {"id": uuid.uuid4().hex[:12], "kiosId": k["id"], "at": _iso(n - timedelta(days=days + 20)), "byId": by, "fromStage": -1, "toStage": 0, "fromStatus": "", "toStatus": "ontrack", "note": "Kandidat kios ditambahkan (*ilustrasi)"})
        if stage > 0:
            await db.put("stagelog", {"id": uuid.uuid4().hex[:12], "kiosId": k["id"], "at": _iso(n - timedelta(days=days)), "byId": by, "fromStage": stage - 1, "toStage": stage, "fromStatus": "ontrack", "toStatus": "ontrack", "note": f"Tahap → {C.STAGES[stage]['n']}"})
        if status != "ontrack":
            await db.put("stagelog", {"id": uuid.uuid4().hex[:12], "kiosId": k["id"], "at": _iso(n - timedelta(days=min(days, 3))), "byId": by, "fromStage": stage, "toStage": stage, "fromStatus": "ontrack", "toStatus": status, "note": note})
        elif note:
            await db.put("comments", {"id": uuid.uuid4().hex[:12], "kiosId": k["id"], "byId": by, "at": _iso(n - timedelta(days=min(days, 3))), "text": note})
    return {"wilayah": len(W), "kios": len(K)}
