"""Lapisan data: MongoDB (motor) atau in-memory dengan persistensi JSON (USE_MOCK_DB)."""
import asyncio, copy, json, os, time
from typing import Any, Dict, List, Optional
from . import config

COLLECTIONS = ["members", "wilayah", "kios", "stagelog", "comments", "settings", "reminderlog", "files"]


def _match(doc: Dict, flt: Dict) -> bool:
    for k, v in flt.items():
        if isinstance(v, dict) and "$in" in v:
            if doc.get(k) not in v["$in"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


class MemoryDB:
    """Penyimpanan in-memory; disimpan ke DATA_DIR/mock.json agar bertahan antar restart lokal."""

    def __init__(self, path: Optional[str] = None):
        self.path = path
        self.data: Dict[str, Dict[str, Dict]] = {c: {} for c in COLLECTIONS}
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    loaded = json.load(f)
                for c in COLLECTIONS:
                    self.data[c] = loaded.get(c, {})
            except Exception:
                pass
        self._lock = asyncio.Lock()

    def _flush(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False)
        os.replace(tmp, self.path)

    async def ping(self) -> bool:
        return True

    async def find(self, col: str, flt: Optional[Dict] = None, sort: Optional[List] = None, limit: int = 0) -> List[Dict]:
        rows = [copy.deepcopy(d) for d in self.data[col].values() if _match(d, flt or {})]
        if sort:
            for key, direction in reversed(sort):
                rows.sort(key=lambda d: (d.get(key) is None, d.get(key)), reverse=direction < 0)
        return rows[:limit] if limit else rows

    async def get(self, col: str, _id: str) -> Optional[Dict]:
        d = self.data[col].get(_id)
        return copy.deepcopy(d) if d else None

    async def put(self, col: str, doc: Dict) -> Dict:
        async with self._lock:
            self.data[col][doc["id"]] = copy.deepcopy(doc)
            self._flush()
        return doc

    async def update(self, col: str, _id: str, fields: Dict) -> Optional[Dict]:
        async with self._lock:
            d = self.data[col].get(_id)
            if not d:
                return None
            d.update(copy.deepcopy(fields))
            self._flush()
            return copy.deepcopy(d)

    async def delete(self, col: str, _id: str) -> bool:
        async with self._lock:
            ok = self.data[col].pop(_id, None) is not None
            self._flush()
            return ok

    async def count(self, col: str, flt: Optional[Dict] = None) -> int:
        return len(await self.find(col, flt))

    async def dump(self) -> Dict:
        return copy.deepcopy(self.data)


class MongoDB:
    def __init__(self, url: str):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=5000)
        name = (url.rsplit("/", 1)[-1].split("?")[0]) or "crk_expansion"
        self.db = self.client[name if name and name not in ("", "admin") else "crk_expansion"]

    async def ping(self) -> bool:
        try:
            await self.client.admin.command("ping")
            return True
        except Exception:
            return False

    async def ensure_indexes(self):
        await self.db.kios.create_index("wilayahId")
        await self.db.stagelog.create_index([("kiosId", 1), ("at", -1)])
        await self.db.comments.create_index([("kiosId", 1), ("at", -1)])
        await self.db.members.create_index("name")

    @staticmethod
    def _clean(d):
        if d is None:
            return None
        d.pop("_id", None)
        return d

    async def find(self, col, flt=None, sort=None, limit=0):
        cur = self.db[col].find(flt or {})
        if sort:
            cur = cur.sort(sort)
        if limit:
            cur = cur.limit(limit)
        return [self._clean(d) async for d in cur]

    async def get(self, col, _id):
        return self._clean(await self.db[col].find_one({"id": _id}))

    async def put(self, col, doc):
        await self.db[col].replace_one({"id": doc["id"]}, doc, upsert=True)
        return doc

    async def update(self, col, _id, fields):
        r = await self.db[col].find_one_and_update({"id": _id}, {"$set": fields}, return_document=True)
        return self._clean(r)

    async def delete(self, col, _id):
        r = await self.db[col].delete_one({"id": _id})
        return r.deleted_count > 0

    async def count(self, col, flt=None):
        return await self.db[col].count_documents(flt or {})

    async def dump(self):
        return {c: {d["id"]: d for d in await self.find(c)} for c in COLLECTIONS}


def make_db():
    if config.USE_MOCK_DB or not config.MONGO_URL:
        return MemoryDB(os.path.join(config.DATA_DIR, "mock.json"))
    return MongoDB(config.MONGO_URL)
