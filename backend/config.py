"""Konfigurasi & definisi tahapan pipeline — satu sumber untuk backend dan frontend."""
import os
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("TZ", "Asia/Jakarta"))
MONGO_URL = os.getenv("MONGO_URL", "")
USE_MOCK_DB = os.getenv("USE_MOCK_DB", "" if MONGO_URL else "true").lower() in ("1", "true", "yes")
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-secret")
DEFAULT_ADMIN_PIN = os.getenv("DEFAULT_ADMIN_PIN", "1234")
METRICS_API_KEY = os.getenv("METRICS_API_KEY", "change-me-metrics")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")
DATA_DIR = os.getenv("DATA_DIR", "/data" if os.path.isdir("/data") else os.path.join(os.path.dirname(__file__), "..", "data"))
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(DATA_DIR, "uploads"))
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
SMTP = {
    "host": os.getenv("SMTP_HOST", ""), "port": int(os.getenv("SMTP_PORT", "587") or 587),
    "user": os.getenv("SMTP_USER", ""), "pass": os.getenv("SMTP_PASS", ""),
    "from": os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "")),
}
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")

ROLES = ["Manager", "SPV", "Surveyor", "SDO", "Legal", "Finance", "Admin"]
ROLE_LABEL = {"Manager": "Expansion Manager (akses penuh)", "SPV": "SPV Ekspansi", "Surveyor": "Surveyor", "SDO": "Store Development Officer",
              "Legal": "Legal", "Finance": "Finance", "Admin": "Admin (IT / PIN)"}
FULL_ACCESS_ROLES = ("Manager", "Admin")

# Tim ekspansi awal (dokumen Flow Ekspansi 2-1). Dibuat otomatis saat database kosong; PIN dibuat saat login pertama.
TEAM = [
    ("Bram", "bram@citarasakuliner.com", "Manager"),
    ("Andika", "andika@citarasakuliner.com", "SPV"),
    ("Pradittya", "pradittya@citarasakuliner.com", "SPV"),
    ("Syam", "syamvora@citarasakuliner.com", "SDO"),
    ("Brian", "brian@citarasakuliner.com", "Surveyor"),
    ("Handi", "handi@citarasakuliner.com", "Surveyor"),
    ("Tegar", "tegar@citarasakuliner.com", "Surveyor"),
    ("Nurmansyah", "nurmansyah@citarasakuliner.com", "Surveyor"),
    ("Pram", "pramadhyra@citarasakuliner.com", "Surveyor"),
    ("Ryan", "ryan@citarasakuliner.com", "Surveyor"),
]

# index, nama, PIC (label), roles yang boleh memajukan dari tahap ini, fase, internal?
STAGES = [
    {"i": 0, "n": "Kandidat Kios (Pencarian)", "pic": "Surveyor", "roles": ["Surveyor"], "fase": "Pencarian", "internal": True},
    {"i": 1, "n": "Approval Kios", "pic": "SPV", "roles": ["SPV"], "fase": "Pencarian", "internal": True},
    {"i": 2, "n": "Pengajuan Down Payment", "pic": "SPV", "roles": ["SPV", "Finance"], "fase": "Kontrak"},
    {"i": 3, "n": "Legalitas & Pemeriksaan Kepemilikan", "pic": "Surveyor (koordinasi Legal)", "roles": ["Surveyor", "Legal"], "fase": "Kontrak"},
    {"i": 4, "n": "Sepakat SPK", "pic": "Surveyor", "roles": ["Surveyor"], "fase": "Kontrak"},
    {"i": 5, "n": "Penandatanganan SPK", "pic": "Surveyor", "roles": ["Surveyor"], "fase": "Kontrak"},
    {"i": 6, "n": "Pelunasan Sewa", "pic": "SPV", "roles": ["SPV", "Finance"], "fase": "Kontrak"},
    {"i": 7, "n": "Layouting bersama Vendor", "pic": "Surveyor + SDO", "roles": ["Surveyor", "SDO"], "fase": "Renovasi"},
    {"i": 8, "n": "Kesepakatan RAB Vendor", "pic": "Surveyor + SDO", "roles": ["Surveyor", "SDO"], "fase": "Renovasi"},
    {"i": 9, "n": "Pengajuan Pembayaran Vendor", "pic": "SPV", "roles": ["SPV", "Finance"], "fase": "Renovasi"},
    {"i": 10, "n": "Mobilisasi Vendor", "pic": "Store Development Officer", "roles": ["SDO"], "fase": "Renovasi"},
    {"i": 11, "n": "Renovasi Kios", "pic": "Store Development Officer", "roles": ["SDO"], "fase": "Renovasi"},
    {"i": 12, "n": "Serah Terima Kios (Renovasi)", "pic": "Store Development Officer", "roles": ["SDO"], "fase": "Serah Terima"},
    {"i": 13, "n": "Serah Terima Kios (Operasional)", "pic": "SPV + Surveyor", "roles": ["SPV", "Surveyor"], "fase": "Serah Terima"},
    {"i": 14, "n": "Beroperasi", "pic": "Tim Operasional", "roles": [], "fase": "Beroperasi"},
]
LAST_STAGE = len(STAGES) - 1
FASES = ["Pencarian", "Kontrak", "Renovasi", "Serah Terima", "Beroperasi"]
DEFAULT_SLA = {"2": 1, "3": 3, "4": 1, "5": 1, "6": 1, "7": 2, "8": 1, "9": 1, "10": 1, "11": 10, "12": 2, "13": 2}
SLA_VERSION = 2
# SLA gabungan antar flow untuk ditampilkan di Reporting (nama, tahap tercakup, hari)
SLA_GROUPS = [
    ("Pengajuan Pembayaran DP", [2], 1), ("Legalitas + SPK", [3, 4, 5], 5), ("Pelunasan Sewa", [6], 1),
    ("Layouting + RAB", [7, 8], 3), ("Pengajuan Pembayaran Renovasi", [9], 1), ("Mobilisasi Vendor", [10], 1),
    ("Renovasi sampai Opening", [11, 12, 13], 14),
]
CLUSTERS = {"Jabodetabek": "JBD", "Bandung Raya": "BDG", "Jawa Timur": "JTM", "Lainnya": "LN"}
STATUSES = ["ontrack", "perhatian", "blocked", "alternatif"]
STATUS_LABEL = {"ontrack": "On Track", "perhatian": "Perlu Perhatian", "blocked": "Blocked", "alternatif": "Alternatif / Ditolak", "selesai": "Beroperasi"}
WIL_STATUS = ["dibagi", "visit", "cari", "alternatif", "selesai"]
WIL_STATUS_LABEL = {"dibagi": "Dibagi", "visit": "Sudah visit", "cari": "Pencarian kios", "alternatif": "Wilayah alternatif", "selesai": "Selesai"}

DEFAULT_SETTINGS = {
    "appName": "CRK Expansion Tracker", "weeklyUpdateDay": 1, "weeklyUpdateTime": "08:30",
    "dailyDigestTime": "17:00", "nudgeTime": "09:00", "workDays": [1, 2, 3, 4, 5],
    "adminEmail": "", "stalledDays": 7, "stageSla": DEFAULT_SLA, "slaVersion": SLA_VERSION, "monthlyTarget": {}, "lastWeeklyText": "", "lastWeeklyAt": "",
}
