# CRK Expansion Tracker

Pipeline tracker pembukaan kios untuk Tim Ekspansi CRK Group (Cimol Bojot AA). Menggantikan spreadsheet multi-sheet: tim ekspansi mengisi satu kartu per kios, seluruh divisi membaca laporan yang terbentuk otomatis.

- **Tim Ekspansi** (login nama + PIN): wilayah (Pembagian → Visit → Pencarian → Approval), pipeline kios 15 tahap dengan PIC per tahap, gate wajib (DP, SPK, sewa, RAB), status On Track / Perlu Perhatian / Blocked, SLA per tahap, riwayat & komentar, upload SPK/foto, Tugas Saya, Panel Admin.
- **All Divisi · Reporting** (`/laporan?t=<token>`, tanpa login, read-only): Executive Summary, progres per tahap 1–12, daftar kios dalam proses + PIC + langkah berikutnya, flow & PIC, Weekly Update siap copy. Tanpa data sewa/DP/pemilik.
- Job terjadwal WIB: daily digest (SPV), nudge PIC yang lewat SLA, Weekly Update, backup mingguan.
- `GET /api/public-metrics?key=…` untuk Service Excellence Dashboard / Daily Tracker.

Stack: FastAPI + MongoDB (motor) · frontend vanilla JS mobile-first (tanpa build step) · APScheduler · SMTP/Resend. Satu Dockerfile, siap Railway.

## Jalankan lokal
```bash
pip install -r requirements.txt
USE_MOCK_DB=true uvicorn backend.main:app --reload
# buka http://localhost:8000 → Daftar (pendaftar pertama = Admin) → Panel Admin → "Isi data contoh"
pytest -q            # 9 acceptance test
```
Tanpa `MONGO_URL`, data disimpan di `data/mock.json` (cukup untuk uji, bukan produksi).

## Go-live Railway (±15 menit)
1. Push repo ke GitHub → Railway **New Project → Deploy from GitHub repo**. Build memakai `Dockerfile` (lihat `railway.json`).
2. **+ New → Database → MongoDB**. Di service app set variabel: `MONGO_URL` = `${{MongoDB.MONGO_URL}}/crk_expansion` (atau connection string Atlas), `USE_MOCK_DB=false`.
3. Set `SECRET_KEY`, `DEFAULT_ADMIN_PIN`, `METRICS_API_KEY` (bukan nilai bawaan — app menulis warning di log bila masih bawaan), `PUBLIC_BASE_URL` (https domain Railway), `TZ=Asia/Jakarta`. Lihat `.env.example`.
4. **Volume** → mount di `/data` (upload SPK/foto & backup). Tanpa volume, file hilang saat redeploy (data di MongoDB tetap aman).
5. Email: isi `RESEND_API_KEY` **atau** `SMTP_*`. Kosong = email hanya dicatat di log.
6. Settings → Networking → Generate Domain. Buka domain → **Daftar** sebagai Admin (pendaftar pertama otomatis Admin) → undang SPV/Surveyor/SDO/Legal/Finance.
7. Panel Admin → **Impor CSV** dari spreadsheet lama (kolom: `nama;wilayah;kota;cluster;alamat;tahap;status;targetBuka;sewaTahun;dp;vendor;catatan;tanggalUpdate`), cek jumlah kios per tahap, lalu **Copy link** laporan ke grup All Divisi.
8. Jalankan paralel 1 minggu, lalu hentikan update di spreadsheet. Unduh backup mingguan dari Panel (atau pakai MongoDB Atlas dengan backup otomatis).

## Hak akses per tahap
| Tahap | PIC yang boleh memajukan (selain SPV/Admin) |
|---|---|
| 1 Kandidat Kios | Surveyor |
| 2 Approval Kios | SPV |
| 3 Pengajuan DP · 7 Pelunasan Sewa · 10 Pengajuan Pembayaran Vendor | SPV, Finance |
| 4 Legalitas | Surveyor, Legal |
| 5 Sepakat SPK · 6 Penandatanganan SPK | Surveyor |
| 8 Layouting · 9 Kesepakatan RAB | Surveyor, SDO |
| 11 Mobilisasi · 12 Renovasi · 13 Serah Terima (Renovasi) | SDO |
| 14 Serah Terima (Operasional) | SPV, Surveyor |

Kembali tahap: hanya SPV/Admin, catatan wajib. Lompat tahap: hanya Admin, catatan wajib. Status Perlu Perhatian/Blocked: catatan wajib.

## Struktur
```
backend/   main.py (API, aturan, job) · db.py (Mongo / mock) · config.py (tahap, PIC, SLA) · mailer.py · seed.py
frontend/  index.html · app.js · style.css   (disajikan langsung oleh FastAPI)
tests/     test_api.py
Dockerfile · railway.json · .env.example
```
