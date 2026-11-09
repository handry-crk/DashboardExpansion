/* CRK Expansion Tracker — frontend (vanilla JS, mobile-first) */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rp = (n) => (n ? "Rp" + Number(n).toLocaleString("id-ID") : "–");
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const fmtM = (m) => { if (!m) return "–"; const [y, mo] = m.split("-"); return `${BULAN[+mo - 1]} ${y}`; };
  const fmtD = (t) => { if (!t) return "–"; const d = new Date(t); return isNaN(d) ? t : `${d.getDate()} ${BULAN[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
  const fmtDT = (t) => { if (!t) return "–"; const d = new Date(t); return isNaN(d) ? t : fmtD(t) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

  const urlParams = new URLSearchParams(location.search);
  const shareT = urlParams.get("t") || "";
  const reportOnly = location.pathname.startsWith("/laporan");
  let token = localStorage.getItem("crk_token") || "";
  let me = null, S = null, R = null, mode = reportOnly ? "div" : "int";
  let filters = { wil: "", st: "", pic: "", mine: false };
  let pollTimer = null;

  function toast(m, err) { const t = $("toast"); t.textContent = m; t.className = "toast" + (err ? " err" : ""); t.style.display = "block"; clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = "none"), err ? 4000 : 2200); }
  function setSync(cls, txt) { const s = $("sync"); s.className = "sync " + cls; s.querySelector("span").textContent = txt; }

  async function api(path, opts = {}) {
    const h = opts.headers || {};
    if (token) h["Authorization"] = "Bearer " + token;
    if (opts.body && !(opts.body instanceof FormData)) { h["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.body); }
    const r = await fetch(path, { ...opts, headers: h });
    let data = null; try { data = await r.json(); } catch (e) { }
    if (!r.ok) {
      if (r.status === 401 && token && path !== "/api/auth/login") { logout(false); }
      const msg = data && data.detail ? (Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join(", ") : data.detail) : "Gagal (" + r.status + ")";
      throw new Error(msg);
    }
    return data;
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.m)));
    $("ov").addEventListener("click", closeDr);
    $("fab").addEventListener("click", () => openKios());
    if (reportOnly) { $("modes").classList.add("hide"); }
    await refresh();
    document.addEventListener("visibilitychange", () => { if (!document.hidden && (token || reportOnly || shareT)) refresh(true); });
    pollTimer = setInterval(() => { if (!document.hidden && !$("dr").classList.contains("on") && (token || reportOnly || shareT)) refresh(true); }, 8000);
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    try { if (!reportOnly) location.hash = m === "div" ? "reporting" : "internal"; } catch (e) { }
    render();
  }
  if (!reportOnly && location.hash === "#reporting") mode = "div";

  async function refresh(quiet) {
    try {
      if (reportOnly || (!token && mode === "div" && shareT)) {
        R = await api("/api/report?t=" + encodeURIComponent(shareT));
        setSync("ok", "Live · " + fmtDT(R.serverTime));
      } else if (token) {
        S = await api("/api/state");
        me = S.me;
        if (mode === "div") R = await api("/api/report");
        setSync("ok", "Live · " + fmtDT(S.serverTime));
      } else {
        setSync("", "Belum login");
        if (quiet) return;
      }
    } catch (e) {
      setSync("off", e.message);
      if (!quiet) toast(e.message, true);
    }
    render();
  }

  function logout(reload = true) { token = ""; me = null; S = null; localStorage.removeItem("crk_token"); if (reload) location.reload(); }

  // ------------------------------------------------------------ render root
  let loginShown = false;
  function render() {
    const wasLogin = !$("vLogin").classList.contains("hide");
    $("vLogin").classList.add("hide"); $("vInt").classList.add("hide"); $("vDiv").classList.add("hide"); $("fab").classList.add("hide");
    $("who").innerHTML = me ? `${esc(me.name)} · ${esc((S && S.roleLabel && S.roleLabel[me.role]) || me.role)} <button id="btnOut">Keluar</button>` : "";
    if (me) $("btnOut").onclick = () => logout();
    if (reportOnly) { $("vDiv").classList.remove("hide"); renderReport(); return; }
    if (mode === "div") {
      if (!token && !shareT) { $("vLogin").classList.remove("hide"); if (!wasLogin) renderLogin("Login untuk melihat Reporting, atau buka link laporan dari Admin."); return; }
      $("vDiv").classList.remove("hide"); renderReport(); return;
    }
    if (!token) { $("vLogin").classList.remove("hide"); if (!wasLogin) renderLogin(); return; }
    if (!S) return;
    $("vInt").classList.remove("hide"); renderInternal();
    if (canEdit() && window.innerWidth < 700) $("fab").classList.remove("hide");
  }
  const canEdit = () => me && (me.isAdmin || ["Manager", "SPV", "Surveyor", "SDO", "Legal", "Finance"].includes(me.role));

  // ------------------------------------------------------------ login
  let loginTab = "masuk";
  async function renderLogin(msg) {
    const v = $("vLogin");
    let members = [];
    try { members = await api("/api/auth/members"); } catch (e) { }
    const roles = ["Manager", "SPV", "Surveyor", "SDO", "Legal", "Finance"];
    const roleLabel = { Manager: "Expansion Manager", SPV: "SPV Ekspansi", Surveyor: "Surveyor", SDO: "Store Development Officer", Legal: "Legal", Finance: "Finance" };
    v.innerHTML = `<div class="login">
      <h2><b>Masuk</b> Tracker</h2>${msg ? `<div class="note" style="margin-bottom:10px">${esc(msg)}</div>` : ""}
      <div class="tabs"><button data-t="masuk" class="${loginTab === "masuk" ? "on" : ""}">Masuk</button><button data-t="daftar" class="${loginTab === "daftar" ? "on" : ""}">Daftar</button><button data-t="admin" class="${loginTab === "admin" ? "on" : ""}">PIN Admin</button></div>
      <div id="loginBody"></div></div>`;
    v.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { loginTab = b.dataset.t; renderLogin(msg); }));
    const b = $("loginBody");
    if (loginTab === "masuk") {
      b.innerHTML = members.length ? `<div class="f"><div class="full"><label>Nama</label><select id="lMember">${members.map((m) => `<option value="${m.id}" data-haspin="${m.hasPin ? 1 : 0}">${esc(m.name)} — ${esc(roleLabel[m.role] || m.role)}${m.hasPin ? "" : " · PIN belum dibuat"}</option>`).join("")}</select></div>
        <div class="full"><label>PIN</label><input id="lPin" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 digit"><div class="note" id="lPinNote" style="margin-top:4px"></div></div></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="lGo">Masuk</button></div>` : `<div class="empty">Belum ada anggota. Daftar dulu — pendaftar pertama otomatis menjadi Admin.</div>`;
      if (members.length) {
        $("lGo").onclick = doLogin; $("lPin").addEventListener("keydown", (e) => e.key === "Enter" && doLogin());
        const upd = () => { const o = $("lMember").selectedOptions[0]; $("lPinNote").textContent = o && o.dataset.haspin === "0" ? "Login pertama: PIN 4–6 digit yang Anda ketik sekarang akan menjadi PIN Anda." : ""; };
        $("lMember").onchange = upd; upd();
      }
    } else if (loginTab === "daftar") {
      b.innerHTML = `<div class="f"><div class="full"><label>Nama</label><input id="rName"></div>
        <div><label>Role</label><select id="rRole">${roles.map((r) => `<option value="${r}">${roleLabel[r]}</option>`).join("")}</select></div>
        <div><label>PIN (4–6 digit)</label><input id="rPin" type="password" inputmode="numeric" maxlength="6"></div>
        <div><label>Email</label><input id="rEmail" type="email"></div><div><label>WhatsApp (08…)</label><input id="rPhone" inputmode="numeric"></div></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="rGo">Daftar & masuk</button></div>
        <div class="note" style="margin-top:8px">${members.length ? "" : "Pendaftar pertama otomatis menjadi Admin."}</div>`;
      $("rGo").onclick = async () => {
        try { const d = await api("/api/auth/register", { method: "POST", body: { name: $("rName").value, role: $("rRole").value, pin: $("rPin").value, email: $("rEmail").value, phone: $("rPhone").value } }); onLogin(d); } catch (e) { toast(e.message, true); }
      };
    } else {
      b.innerHTML = `<div class="f"><div class="full"><label>PIN Admin</label><input id="aPin" type="password" inputmode="numeric" maxlength="6"></div></div><div class="row" style="margin-top:12px"><button class="btn" id="aGo">Masuk sebagai Admin</button></div><div class="note" style="margin-top:8px">PIN cadangan untuk admin (diatur di Panel Admin). Sesi 1 hari.</div>`;
      $("aGo").onclick = async () => { try { onLogin(await api("/api/auth/admin-login", { method: "POST", body: { pin: $("aPin").value } })); } catch (e) { toast(e.message, true); } };
    }
  }
  async function doLogin() { try { onLogin(await api("/api/auth/login", { method: "POST", body: { memberId: $("lMember").value, pin: $("lPin").value } })); } catch (e) { toast(e.message, true); } }
  function onLogin(d) { token = d.token; localStorage.setItem("crk_token", token); me = d.member; if (d.pinCreated) toast("PIN Anda tersimpan. Gunakan PIN ini untuk login berikutnya."); refresh(); }

  // ------------------------------------------------------------ helpers on state
  const stageOf = (i) => S.stages[i];
  const statusKey = (k) => k.statusKey;
  function kpi(n, l, d) { return `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div><div class="d">${d || ""}</div></div>`; }
  function stPill(k) { return `<span class="st ${k.statusKey}"><i></i>${esc(k.statusLabel)}</span>`; }
  function flags(k) { let h = ""; if (k.lewatSla) h += ` <span class="badge">SLA +${k.daysInStage - k.sla}h</span>`; else if (k.stalled) h += ` <span class="badge w">tanpa update ${k.daysInStage}h</span>`; if (k.lewatTarget) h += ` <span class="badge m">lewat target</span>`; return h; }

  // ------------------------------------------------------------ internal view
  function renderInternal() {
    const v = $("vInt");
    const act = S.kios.filter((k) => k.status !== "alternatif");
    const inProc = act.filter((k) => k.stage >= 2 && k.stage < 14);
    const mine = act.filter((k) => k.stage < 14 && (stageOf(k.stage).roles.includes(me.role) || (me.role === "SPV" && k.stage === 1))).sort((a, b) => b.daysInStage - a.daysInStage);
    const wilNames = S.wilayah.map((w) => w.nama);
    const picRoles = ["SPV", "Surveyor", "SDO", "Legal", "Finance"];
    const roleLabel = S.roleLabel || {};
    v.innerHTML = `
    <section><h2><b>Ringkasan</b> Pipeline</h2><div class="sub">Angka otomatis dari data wilayah & kios</div>
      <div class="grid kpis">
        ${kpi(S.wilayah.filter((w) => !["selesai", "alternatif"].includes(w.status)).length, "Wilayah aktif", "dibagi / visit / pencarian")}
        ${kpi(act.filter((k) => k.stage === 0).length, "Kandidat kios", "hasil pencarian surveyor")}
        ${kpi(act.filter((k) => k.stage === 1).length, "Menunggu approval", "PIC: SPV")}
        ${kpi(inProc.length, "Kios dalam proses", `${inProc.filter((k) => k.lewatSla).length} lewat SLA · ${inProc.filter((k) => k.lewatTarget).length} lewat target`)}
        ${kpi(inProc.filter((k) => k.status === "blocked").length, "Blocked", "butuh eskalasi")}
        ${kpi(act.filter((k) => k.stage === 14).length, "Beroperasi", "sudah serah terima operasional")}
      </div></section>
    ${mine.length ? `<section><h2><b>Tugas</b> Saya</h2><div class="sub">Kios yang tahapnya menunggu role ${esc(me.role)}</div><div id="mine"></div></section>` : ""}
    <section><div class="row"><div><h2><b>Wilayah</b> & Pencarian</h2><div class="sub">Pembagian Wilayah → Visit → Pencarian Kios → Approval</div></div><div class="sp"></div>${canEdit() ? `<button class="btn s" id="bWil">+ Wilayah</button>` : ""}</div>
      <div class="card tscroll"><table class="tbl cards" id="tWil"></table></div></section>
    <section><div class="row"><div><h2><b>Pipeline</b> Kios</h2><div class="sub">Klik kartu untuk update tahap, status, dan catatan</div></div><div class="sp"></div>${canEdit() ? `<button class="btn s" id="bKios">+ Kios</button>` : ""}</div>
      <div class="row" style="margin-bottom:10px">
        <select id="fWil" class="inl"><option value="">Semua wilayah</option>${wilNames.map((w) => `<option ${w === filters.wil ? "selected" : ""}>${esc(w)}</option>`).join("")}</select>
        <select id="fSt" class="inl"><option value="">Semua status</option>${["ontrack", "perhatian", "blocked", "alternatif", "selesai"].map((s) => `<option value="${s}" ${s === filters.st ? "selected" : ""}>${S.statusLabel[s]}</option>`).join("")}</select>
        <select id="fPic" class="inl"><option value="">Semua PIC</option>${picRoles.map((r) => `<option ${r === filters.pic ? "selected" : ""}>${r}</option>`).join("")}</select>
        <label class="chip ${filters.mine ? "on" : ""}" id="fMine" style="margin:0">Hanya tugas saya</label>
      </div>
      <div class="fases" id="fases"></div></section>
    ${me.isAdmin ? `<section><h2><b>Panel</b> Admin</h2><div class="sub">Anggota, pengaturan, link laporan, impor/ekspor, job</div><div id="panel"></div></section>` : ""}`;
    if ($("bWil")) $("bWil").onclick = () => openWil();
    if ($("bKios")) $("bKios").onclick = () => openKios();
    $("fWil").onchange = (e) => { filters.wil = e.target.value; renderPipeline(); };
    $("fSt").onchange = (e) => { filters.st = e.target.value; renderPipeline(); };
    $("fPic").onchange = (e) => { filters.pic = e.target.value; renderPipeline(); };
    $("fMine").onclick = () => { filters.mine = !filters.mine; $("fMine").classList.toggle("on", filters.mine); renderPipeline(); };
    if (mine.length) $("mine").innerHTML = mine.slice(0, 8).map(card).join("");
    // wilayah table
    const rows = S.wilayah.slice().sort((a, b) => a.nama.localeCompare(b.nama));
    $("tWil").innerHTML = `<thead><tr><th>Wilayah</th><th>Kota</th><th>SPV</th><th>Surveyor</th><th>Status</th><th class="r">Kios</th><th>Catatan</th></tr></thead><tbody>` +
      (rows.length ? rows.map((w) => `<tr class="click" data-w="${w.id}"><td data-l=""><b>${esc(w.nama)}</b> <span class="note">${esc(w.cluster)}</span></td><td data-l="Kota">${esc(w.kota)}</td><td data-l="SPV">${esc(w.spvName) || "–"}</td><td data-l="Surveyor">${esc(w.surveyorName) || "–"}</td><td data-l="Status"><span class="pill ${w.status === "alternatif" ? "m" : ""}">${S.wilStatusLabel[w.status]}</span></td><td data-l="Kios approved / target" class="r">${w.approvedCount} / ${w.targetKios || 1} <span class="note">(${w.kiosCount} kandidat)</span></td><td data-l="Catatan" class="note">${esc(w.catatan)}</td></tr>`).join("")
        : `<tr><td colspan="7"><div class="empty">Belum ada wilayah. Mulai dari "+ Wilayah" (langkah 1: Pembagian Wilayah oleh SPV).</div></td></tr>`) + `</tbody>`;
    $("tWil").querySelectorAll("tr[data-w]").forEach((tr) => (tr.onclick = () => openWil(tr.dataset.w)));
    renderPipeline();
    if (me.isAdmin) renderPanel();
    document.querySelectorAll(".kios[data-k]").forEach((c) => (c.onclick = () => openKios(c.dataset.k)));
  }

  function card(k) {
    const pct = Math.round((k.stage / 14) * 100);
    return `<div class="kios ${k.statusKey}" data-k="${k.id}"><b>${esc(k.nama)} <span class="note">${esc(k.kode)}</span></b><small>${esc(k.wilayahNama)} · ${esc(k.stageName)}</small><small>PIC ${esc(k.stagePic)} · target ${fmtM(k.targetBuka)} · ${k.daysInStage} hari di tahap</small><div class="row" style="margin-top:4px;gap:6px">${stPill(k)}${flags(k)}</div><div class="prog"><i style="width:${pct}%"></i></div></div>`;
  }

  function renderPipeline() {
    let list = S.kios.filter((k) => (!filters.wil || k.wilayahNama === filters.wil) && (!filters.st || k.statusKey === filters.st) && (!filters.pic || stageOf(k.stage).roles.includes(filters.pic)) && (!filters.mine || stageOf(k.stage).roles.includes(me.role)));
    const el = $("fases");
    if (!S.kios.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">Belum ada kios. Tambahkan kandidat kios dari hasil visit surveyor${me.isAdmin ? ", atau isi data contoh dari Panel Admin" : ""}.</div>`; return; }
    el.innerHTML = S.fases.map((f) => {
      const items = list.filter((k) => k.fase === f).sort((a, b) => b.stage - a.stage || b.daysInStage - a.daysInStage);
      const idx = S.stages.filter((s) => s.fase === f).map((s) => s.i + 1);
      return `<div class="fase"><h3>${f}</h3><div class="c">Tahap ${idx[0]}${idx.length > 1 ? "–" + idx[idx.length - 1] : ""} · ${items.length} kios</div>${items.map(card).join("") || '<div class="note">–</div>'}</div>`;
    }).join("");
    el.querySelectorAll(".kios[data-k]").forEach((c) => (c.onclick = () => openKios(c.dataset.k)));
  }

  // ------------------------------------------------------------ drawers
  function closeDr() { $("ov").classList.remove("on"); $("dr").classList.remove("on"); }
  function showDr(html) { $("dr").innerHTML = html; $("ov").classList.add("on"); $("dr").classList.add("on"); $("dr").scrollTop = 0; }

  async function openKios(id) {
    const k = id ? S.kios.find((x) => x.id === id) : null;
    const d = k || { stage: 0, status: "ontrack", targetBuka: "", wilayahId: filters.wil ? (S.wilayah.find((w) => w.nama === filters.wil) || {}).id : "" };
    const st = stageOf(d.stage);
    const ro = !canEdit();
    const mayAdvance = k && k.stage < 14 && k.status !== "alternatif" && (me.isAdmin || ["Manager", "SPV"].includes(me.role) || st.roles.includes(me.role));
    const mayBack = k && k.stage > 0 && (me.isAdmin || ["Manager", "SPV"].includes(me.role));
    showDr(`<div class="row"><h3>${k ? esc(k.nama) : "Kios baru"}</h3><div class="sp"></div><button class="btn g s" id="dClose">Tutup</button></div>
      <div class="note" style="margin:4px 0 10px">${k ? `${esc(k.kode)} · ${esc(k.stageName)} · PIC ${esc(k.stagePic)} · ${k.daysInStage} hari di tahap${k.sla ? ` (SLA ${k.sla} hari)` : ""} ${flags(k)}` : "Masukkan kandidat kios dari hasil pencarian (PIC Surveyor)"}</div>
      ${k ? `<div class="steps">${S.stages.map((s) => `<span class="${s.i < k.stage ? "done" : s.i === k.stage ? "cur" : ""}" title="${esc(s.n)}">${s.i + 1}</span>`).join("")}</div>` : ""}
      ${k && k.stage < 14 ? `<div class="card" style="padding:10px;margin-bottom:12px"><b>Tahap berikutnya:</b> ${esc(k.nextStage)} <span class="pill">${esc(k.nextPic)}</span>
        <div class="row" style="margin-top:8px"><input id="sNote" class="inl" style="flex:1;min-width:160px" placeholder="Catatan (wajib bila kembali / lompat)">
        ${mayAdvance ? `<button class="btn s" id="bNext">Tahap berikutnya →</button>` : `<span class="note">Hanya ${esc(st.pic)} / SPV yang dapat memajukan</span>`}
        ${mayBack ? `<button class="btn o s" id="bBack">← Kembali</button>` : ""}</div>
        <div class="row" style="margin-top:8px"><select id="sStatus" class="inl"><option value="ontrack" ${k.status === "ontrack" ? "selected" : ""}>On Track</option><option value="perhatian" ${k.status === "perhatian" ? "selected" : ""}>Perlu Perhatian</option><option value="blocked" ${k.status === "blocked" ? "selected" : ""}>Blocked</option></select>
        ${!ro && k.status !== "alternatif" ? `<button class="btn o s" id="bStatus">Ubah status</button>` : ""}${k.status === "alternatif" ? `<button class="btn o s" id="bReopen">Buka kembali</button>` : (!ro ? `<button class="btn g s" id="bAlt">Jadikan alternatif</button>` : "")}</div></div>` : ""}
      <div class="f">
        <div class="full"><label>Nama / lokasi kios</label><input id="kNama" value="${esc(d.nama || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Wilayah</label><select id="kWil" ${ro ? "disabled" : ""}><option value="">– pilih –</option>${S.wilayah.map((w) => `<option value="${w.id}" ${w.id === d.wilayahId ? "selected" : ""}>${esc(w.nama)}</option>`).join("")}</select></div>
        <div><label>Target buka (bulan)</label><input id="kTarget" type="month" value="${esc(d.targetBuka || "")}" ${ro ? "disabled" : ""}></div>
        <div class="full"><label>Alamat</label><input id="kAlamat" value="${esc(d.alamat || "")}" ${ro ? "disabled" : ""}></div>
        <div class="full"><label>Link Google Maps</label><input id="kMaps" value="${esc(d.mapsUrl || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Luas (m²)</label><input id="kLuas" type="number" value="${d.luas || ""}" ${ro ? "disabled" : ""}></div>
        <div><label>Sewa / tahun (Rp)</label><input id="kSewa" type="number" value="${d.sewaTahun || ""}" ${ro ? "disabled" : ""}></div>
        <div><label>Down payment (Rp)</label><input id="kDp" type="number" value="${d.dp || ""}" ${ro ? "disabled" : ""}></div>
        <div><label>RAB vendor (Rp)</label><input id="kRab" type="number" value="${d.rabNilai || ""}" ${ro ? "disabled" : ""}></div>
        <div><label>Pemilik</label><input id="kPemilik" value="${esc(d.pemilikNama || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>HP pemilik</label><input id="kPemilikHp" value="${esc(d.pemilikHp || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Vendor renovasi</label><input id="kVendor" value="${esc(d.vendorNama || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Progres renovasi (%)</label><input id="kPct" type="number" min="0" max="100" value="${d.renovasiPct || 0}" ${ro ? "disabled" : ""}></div>
        <div class="full"><label>Catatan umum</label><textarea id="kNote" ${ro ? "disabled" : ""}>${esc(d.catatan || "")}</textarea></div>
      </div>
      <div class="row" style="margin-top:12px">${!ro ? `<button class="btn" id="bSave">Simpan</button>` : ""}<div class="sp"></div>${k && me.isAdmin ? `<button class="btn g s" id="bDel">Hapus</button>` : ""}</div>
      ${k ? `<div style="margin-top:14px"><b>Dokumen & foto</b><div class="note">SPK: ${k.spkFile ? `<a href="${esc(k.spkFile)}" target="_blank">${esc(k.spkFileName || "file SPK")}</a>` : "belum ada"} ${!ro ? `· <label style="display:inline;cursor:pointer;color:var(--red)">unggah SPK<input type="file" id="fSpk" class="hide"></label>` : ""}</div>
        <div class="row" style="margin-top:6px">${(k.photos || []).map((p) => `<a href="${esc(p.url)}" target="_blank" class="pill ink">${esc(p.name || "foto")}</a>`).join("")}${!ro ? `<label class="pill" style="cursor:pointer">+ foto<input type="file" id="fPhoto" accept="image/*" capture="environment" class="hide"></label>` : ""}</div></div>
      <div style="margin-top:14px"><b>Riwayat & komentar</b>
        <div class="row" style="margin-top:6px"><input id="cText" class="inl" style="flex:1" placeholder="Tulis komentar… (@nama untuk notifikasi email)"><button class="btn o s" id="bCm">Kirim</button></div>
        <div class="log" id="kLog"><div class="note">Memuat…</div></div></div>` : ""}`);
    $("dClose").onclick = closeDr;
    const collect = () => ({ nama: $("kNama").value.trim(), wilayahId: $("kWil").value, targetBuka: $("kTarget").value, alamat: $("kAlamat").value.trim(), mapsUrl: $("kMaps").value.trim(), luas: +$("kLuas").value || 0, sewaTahun: +$("kSewa").value || 0, dp: +$("kDp").value || 0, rabNilai: +$("kRab").value || 0, pemilikNama: $("kPemilik").value.trim(), pemilikHp: $("kPemilikHp").value.trim(), vendorNama: $("kVendor").value.trim(), renovasiPct: +$("kPct").value || 0, catatan: $("kNote").value.trim() });
    const save = async () => { const body = collect(); if (!body.nama) throw new Error("Nama kios wajib diisi"); if (!body.wilayahId) throw new Error("Pilih wilayah"); return k ? api(`/api/kios/${k.id}`, { method: "PUT", body }) : api("/api/kios", { method: "POST", body }); };
    const run = async (fn, ok) => { try { await fn(); toast(ok || "Tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } };
    if ($("bSave")) $("bSave").onclick = () => run(async () => { await save(); closeDr(); });
    if ($("bNext")) $("bNext").onclick = () => run(async () => { await save(); await api(`/api/kios/${k.id}/stage`, { method: "POST", body: { to: k.stage + 1, note: $("sNote").value } }); closeDr(); }, "Tahap dimajukan");
    if ($("bBack")) $("bBack").onclick = () => run(async () => { await save(); await api(`/api/kios/${k.id}/stage`, { method: "POST", body: { to: k.stage - 1, note: $("sNote").value } }); closeDr(); }, "Tahap dikembalikan");
    if ($("bStatus")) $("bStatus").onclick = () => run(async () => { await api(`/api/kios/${k.id}/status`, { method: "POST", body: { status: $("sStatus").value, note: $("sNote").value } }); closeDr(); }, "Status diubah");
    if ($("bAlt")) $("bAlt").onclick = () => run(async () => { const n = $("sNote").value; if (!n.trim()) throw new Error("Isi catatan alasan di kolom catatan dulu"); await api(`/api/kios/${k.id}/alternatif`, { method: "POST", body: { note: n } }); closeDr(); }, "Kios dijadikan alternatif");
    if ($("bReopen")) $("bReopen").onclick = () => run(async () => { await api(`/api/kios/${k.id}/alternatif`, { method: "POST", body: { note: "Dibuka kembali" } }); closeDr(); }, "Kios dibuka kembali");
    if ($("bDel")) $("bDel").onclick = () => confirmTwice("Hapus kios ini? Tekan Hapus lagi untuk konfirmasi.", () => run(async () => { await api(`/api/kios/${k.id}`, { method: "DELETE" }); closeDr(); }, "Dihapus"));
    if ($("bCm")) $("bCm").onclick = () => run(async () => { const t = $("cText").value.trim(); if (!t) return; await api(`/api/kios/${k.id}/comments`, { method: "POST", body: { text: t } }); $("cText").value = ""; loadTimeline(k.id); }, "Komentar terkirim");
    const up = (inputId, kind) => { const el = $(inputId); if (!el) return; el.onchange = () => run(async () => { const fd = new FormData(); fd.append("file", el.files[0]); await api(`/api/kios/${k.id}/files?kind=${kind}`, { method: "POST", body: fd }); closeDr(); }, "File diunggah"); };
    up("fSpk", "spk"); up("fPhoto", "photo");
    if (k) loadTimeline(k.id);
  }
  async function loadTimeline(id) {
    try {
      const items = await api(`/api/kios/${id}/timeline`);
      $("kLog").innerHTML = items.map((i) => i.type === "comment" ? `<div class="cm"><small>${fmtDT(i.at)} · ${esc(i.byName)}</small>${esc(i.text)}</div>` : `<div><small>${fmtDT(i.at)} · ${esc(i.byName)} · ${esc(S.stages[i.toStage]?.n || "")}${i.toStatus && i.toStatus !== i.fromStatus ? " · " + esc(S.statusLabel[i.toStatus] || i.toStatus) : ""}</small>${esc(i.note)}</div>`).join("") || '<div class="note">Belum ada riwayat</div>';
    } catch (e) { $("kLog").innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  }
  let _conf = null;
  function confirmTwice(msg, fn) { if (_conf === fn) { _conf = null; fn(); return; } _conf = fn; toast(msg); setTimeout(() => (_conf = null), 4000); }

  function openWil(id) {
    const w = id ? S.wilayah.find((x) => x.id === id) : null;
    const d = w || { status: "dibagi", cluster: "Jabodetabek", targetKios: 1 };
    const ro = !canEdit();
    const people = (role) => S.members.filter((m) => m.role === role || m.role === "Manager").map((m) => `<option value="${m.id}" ${m.id === (role === "SPV" ? d.spvId : d.surveyorId) ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    showDr(`<div class="row"><h3>${w ? esc(w.nama) : "Wilayah baru"}</h3><div class="sp"></div><button class="btn g s" id="dClose">Tutup</button></div>
      <div class="f" style="margin-top:12px">
        <div><label>Nama wilayah</label><input id="wNama" value="${esc(d.nama || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Kota</label><input id="wKota" value="${esc(d.kota || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Cluster</label><select id="wCl" ${ro ? "disabled" : ""}>${S.clusters.map((c) => `<option ${c === d.cluster ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Status</label><select id="wStatus" ${ro ? "disabled" : ""}>${["dibagi", "visit", "cari", "alternatif", "selesai"].map((s, i) => `<option value="${s}" ${s === d.status ? "selected" : ""}>${i < 3 ? i + 1 + " · " : ""}${S.wilStatusLabel[s]}</option>`).join("")}</select></div>
        <div><label>SPV</label><select id="wSpv" ${ro ? "disabled" : ""}><option value="">–</option>${people("SPV")}</select></div>
        <div><label>Surveyor</label><select id="wSur" ${ro ? "disabled" : ""}><option value="">–</option>${people("Surveyor")}</select></div>
        <div><label>Target jumlah kios</label><input id="wTarget" type="number" min="1" value="${d.targetKios || 1}" ${ro ? "disabled" : ""}></div>
        <div><label>Target bulan</label><input id="wBulan" type="month" value="${esc(d.targetBulan || "")}" ${ro ? "disabled" : ""}></div>
        <div><label>Tanggal visit</label><input id="wVisit" type="date" value="${esc(d.visitDate || "")}" ${ro ? "disabled" : ""}></div>
        <div class="full"><label>Catatan visit</label><textarea id="wVNote" ${ro ? "disabled" : ""}>${esc(d.visitNotes || "")}</textarea></div>
        <div class="full"><label>Catatan</label><textarea id="wNote" ${ro ? "disabled" : ""}>${esc(d.catatan || "")}</textarea></div>
      </div>
      <div class="row" style="margin-top:12px">${!ro ? `<button class="btn" id="bSave">Simpan</button>` : ""}${w && !ro && w.status !== "alternatif" ? `<button class="btn o" id="bAlt">Ganti wilayah alternatif</button>` : ""}<div class="sp"></div>${w && me.isAdmin ? `<button class="btn g s" id="bDel">Hapus</button>` : ""}</div>
      <div id="altBox" class="hide card" style="margin-top:10px"><div class="f"><div><label>Nama wilayah alternatif</label><input id="aNama"></div><div><label>Kota</label><input id="aKota"></div><div class="full"><label>Alasan</label><input id="aNote"></div></div><div class="row" style="margin-top:8px"><button class="btn s" id="aGo">Buat wilayah alternatif</button></div></div>
      ${w ? `<div style="margin-top:14px"><b>Kios di wilayah ini</b>${S.kios.filter((k) => k.wilayahId === w.id).map(card).join("") || '<div class="note">Belum ada kandidat kios</div>'}</div>` : ""}`);
    $("dClose").onclick = closeDr;
    $("dr").querySelectorAll(".kios[data-k]").forEach((c) => (c.onclick = () => openKios(c.dataset.k)));
    const body = () => ({ nama: $("wNama").value.trim(), kota: $("wKota").value.trim(), cluster: $("wCl").value, status: $("wStatus").value, spvId: $("wSpv").value, surveyorId: $("wSur").value, targetKios: +$("wTarget").value || 1, targetBulan: $("wBulan").value, visitDate: $("wVisit").value, visitNotes: $("wVNote").value.trim(), catatan: $("wNote").value.trim() });
    const run = async (fn, ok) => { try { await fn(); toast(ok || "Tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } };
    if ($("bSave")) $("bSave").onclick = () => run(async () => { const b = body(); if (!b.nama) throw new Error("Nama wilayah wajib diisi"); await (w ? api(`/api/wilayah/${w.id}`, { method: "PUT", body: b }) : api("/api/wilayah", { method: "POST", body: b })); closeDr(); });
    if ($("bAlt")) $("bAlt").onclick = () => $("altBox").classList.toggle("hide");
    if ($("aGo")) $("aGo").onclick = () => run(async () => { await api(`/api/wilayah/${w.id}/alternatif`, { method: "POST", body: { namaAlternatif: $("aNama").value, kota: $("aKota").value, catatan: $("aNote").value } }); closeDr(); }, "Wilayah alternatif dibuat");
    if ($("bDel")) $("bDel").onclick = () => confirmTwice("Hapus wilayah ini? Tekan Hapus lagi untuk konfirmasi.", () => run(async () => { await api(`/api/wilayah/${w.id}`, { method: "DELETE" }); closeDr(); }, "Dihapus"));
  }

  // ------------------------------------------------------------ admin panel
  function renderPanel() {
    const s = S.settings;
    const link = location.origin + "/laporan?t=" + encodeURIComponent(s.shareToken || "");
    $("panel").innerHTML = `
      <div class="card" style="margin-bottom:10px"><b>Link laporan All Divisi</b><div class="note" style="margin:4px 0 8px">Bagikan ke grup divisi lain — read-only, tanpa login, tanpa data sewa/DP/pemilik.</div>
        <div class="row"><input class="inl" style="flex:1;min-width:200px" value="${esc(link)}" readonly id="shareLink"><button class="btn o s" id="bCopyLink">Copy link</button><button class="btn g s" id="bRegen">Buat token baru</button></div></div>
      <div class="card" style="margin-bottom:10px"><b>Pengaturan</b><div class="f" style="margin-top:8px">
        <div><label>Nama aplikasi</label><input id="sApp" value="${esc(s.appName)}"></div><div><label>Email admin (tembusan)</label><input id="sEmail" value="${esc(s.adminEmail || "")}"></div>
        <div><label>Daily digest (WIB)</label><input id="sDigest" value="${esc(s.dailyDigestTime)}" placeholder="17:00"></div><div><label>Nudge PIC (WIB)</label><input id="sNudge" value="${esc(s.nudgeTime)}" placeholder="09:00"></div>
        <div><label>Weekly update: hari (1=Senin)</label><input id="sWDay" type="number" min="1" max="7" value="${s.weeklyUpdateDay}"></div><div><label>Weekly update: jam</label><input id="sWTime" value="${esc(s.weeklyUpdateTime)}"></div>
        <div><label>Tandai tanpa update setelah (hari)</label><input id="sStalled" type="number" value="${s.stalledDays}"></div><div><label>PIN Admin baru (kosongkan bila tetap)</label><input id="sPin" inputmode="numeric" maxlength="6"></div>
        <div class="full"><label>SLA hari per tahap</label><div class="row">${S.stages.filter((x) => x.i >= 2 && x.i < 14).map((x) => `<label style="display:flex;align-items:center;gap:4px;margin:0"><span class="note" style="width:150px">${x.i - 1}. ${esc(x.n)}</span><input class="inl sla" data-i="${x.i}" type="number" style="width:64px" value="${(s.stageSla || {})[x.i] ?? ""}"></label>`).join("")}</div></div>
      </div><div class="row" style="margin-top:10px"><button class="btn" id="bSaveSet">Simpan pengaturan</button></div></div>
      <div class="card" style="margin-bottom:10px"><b>Job & data</b><div class="row" style="margin-top:8px">
        <button class="btn o s" data-job="digest">Kirim daily digest</button><button class="btn o s" data-job="nudge">Kirim nudge PIC</button><button class="btn o s" data-job="weekly">Kirim Weekly Update</button><button class="btn o s" data-job="backup">Backup sekarang</button>
        <a class="btn g s" href="#" id="bExport">Ekspor CSV</a><label class="btn g s" style="cursor:pointer">Impor CSV<input type="file" id="fImport" accept=".csv" class="hide"></label>${S.kios.length ? "" : `<button class="btn g s" id="bSeed">Isi data contoh</button>`}</div>
        <div class="note" style="margin-top:6px">Kolom impor: nama; wilayah; kota; cluster; alamat; tahap; status; targetBuka; sewaTahun; dp; vendor; catatan; tanggalUpdate. Email terkirim hanya bila SMTP/Resend diisi di environment.</div><div id="jobOut" class="note"></div></div>
      <div class="card"><div class="row"><b>Anggota</b><div class="sp"></div><button class="btn g s" id="bTeam">Tambah tim dari dokumen Flow</button></div><div style="margin-top:8px" id="members"></div></div>`;
    $("bCopyLink").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Link disalin")).catch(() => toast("Salin manual dari kolom", true));
    $("bRegen").onclick = () => confirmTwice("Token lama akan mati. Tekan lagi untuk konfirmasi.", () => saveSettings({ regenerateShareToken: true }));
    $("bSaveSet").onclick = () => { const sla = {}; document.querySelectorAll(".sla").forEach((i) => { if (i.value) sla[i.dataset.i] = +i.value; }); saveSettings({ appName: $("sApp").value, adminEmail: $("sEmail").value, dailyDigestTime: $("sDigest").value, nudgeTime: $("sNudge").value, weeklyUpdateDay: +$("sWDay").value, weeklyUpdateTime: $("sWTime").value, stalledDays: +$("sStalled").value, stageSla: sla, adminPin: $("sPin").value || undefined }); };
    document.querySelectorAll("[data-job]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/jobs/${b.dataset.job}/run`, { method: "POST" }); $("jobOut").textContent = JSON.stringify(r).slice(0, 400); toast("Job dijalankan"); } catch (e) { toast(e.message, true); } b.disabled = false; }));
    $("bExport").onclick = async (e) => { e.preventDefault(); try { const r = await fetch("/api/export.csv", { headers: { Authorization: "Bearer " + token } }); const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "expansion-tracker.csv"; a.click(); } catch (e2) { toast("Gagal ekspor", true); } };
    $("fImport").onchange = async () => { const fd = new FormData(); fd.append("file", $("fImport").files[0]); try { const r = await api("/api/import", { method: "POST", body: fd }); toast(`Impor: ${r.kiosBaru} kios, ${r.wilayahBaru} wilayah baru`); refresh(true); } catch (e) { toast(e.message, true); } };
    if ($("bSeed")) $("bSeed").onclick = async () => { try { await api("/api/seed", { method: "POST" }); toast("Data contoh terisi"); refresh(true); } catch (e) { toast(e.message, true); } };
    $("bTeam").onclick = async () => { try { const r = await api("/api/team/preset", { method: "POST" }); toast(`${r.ditambahkan} anggota ditambahkan`); refresh(true); } catch (e) { toast(e.message, true); } };
    $("members").innerHTML = S.members.map((m) => `<div class="mcard"><div class="row"><div><b>${esc(m.name)} ${m.isAdmin ? '<span class="pill">Admin</span>' : ""}${m.active ? "" : ' <span class="pill m">nonaktif</span>'}${m.hasPin === false ? ' <span class="pill m">PIN belum dibuat</span>' : ""}</b><span class="note">${esc(m.email || "–")} · ${esc(m.phone || "–")}</span></div><div class="sp"></div>
      <select class="inl mRole" data-id="${m.id}">${S.roles.map((r) => `<option ${r === m.role ? "selected" : ""}>${r}</option>`).join("")}</select>
      <button class="btn g s mAct" data-id="${m.id}" data-v="${m.active ? 0 : 1}">${m.active ? "Nonaktifkan" : "Aktifkan"}</button>
      <button class="btn g s mAdm" data-id="${m.id}" data-v="${m.isAdmin ? 0 : 1}">${m.isAdmin ? "Cabut admin" : "Jadikan admin"}</button>
      <button class="btn o s mPin" data-id="${m.id}">Reset PIN</button></div></div>`).join("") || '<div class="note">Belum ada anggota</div>';
    const upd = (id, body) => api(`/api/members/${id}`, { method: "PUT", body }).then(() => { toast("Tersimpan"); refresh(true); }).catch((e) => toast(e.message, true));
    document.querySelectorAll(".mRole").forEach((s) => (s.onchange = () => upd(s.dataset.id, { role: s.value })));
    document.querySelectorAll(".mAct").forEach((b) => (b.onclick = () => upd(b.dataset.id, { active: b.dataset.v === "1" })));
    document.querySelectorAll(".mAdm").forEach((b) => (b.onclick = () => upd(b.dataset.id, { isAdmin: b.dataset.v === "1" })));
    document.querySelectorAll(".mPin").forEach((b) => (b.onclick = () => { const pin = window.prompt ? prompt("PIN baru (4–6 digit)") : null; if (!pin) return; api(`/api/members/${b.dataset.id}/reset-pin`, { method: "POST", body: { pin } }).then(() => toast("PIN direset")).catch((e) => toast(e.message, true)); }));
  }
  async function saveSettings(body) { try { await api("/api/settings", { method: "PUT", body }); toast("Pengaturan tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } }

  // ------------------------------------------------------------ reporting view
  function renderReport() {
    const v = $("vDiv");
    if (!R) { v.innerHTML = `<div class="empty" style="margin-top:20px">${shareT || token ? "Memuat laporan…" : "Link laporan tidak valid."}</div>`; return; }
    const sm = R.summary;
    const inProc = R.kios.filter((k) => k.stage < 14).sort((a, b) => (a.targetBuka || "9").localeCompare(b.targetBuka || "9") || b.stage - a.stage);
    const open = R.kios.filter((k) => k.stage === 14).sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
    const mx = Math.max(1, ...Object.values(sm.byStage));
    v.innerHTML = `
      <section><h2><b>Executive</b> Summary</h2><div class="sub">Status ekspansi untuk seluruh divisi — diperbarui otomatis dari Tim Ekspansi</div>
        <div class="grid kpis">${kpi(sm.beroperasi, "Kios beroperasi", "hasil ekspansi berjalan")}${kpi(sm.dalamProses, "Dalam proses", "approved, menuju serah terima")}${kpi(sm.kontrak, "Tahap kontrak", "DP → pelunasan sewa")}${kpi(sm.renovasi, "Tahap renovasi", "layouting → renovasi")}${kpi(sm.targetBulanIni, "Target buka bulan ini", fmtM(R.month))}${kpi(sm.blocked + sm.lewatSla, "Perlu perhatian", "blocked atau lewat SLA")}</div>
        <div class="callout">${esc(R.headline)}</div></section>
      <section><h2><b>Progres</b> per Tahap</h2><div class="sub">Jumlah kios approved yang sedang berada di setiap tahap</div>
        <div class="card funnel">${R.stages.filter((s) => s.i < 14).map((s) => `<div class="b"><span>${s.i - 1}. ${esc(s.n)}</span><div class="bar"><i style="width:${((sm.byStage[s.i] || 0) / mx) * 100}%"></i></div><span class="n">${sm.byStage[s.i] || 0}</span></div>`).join("")}</div></section>
      <section><h2><b>Daftar</b> Kios dalam Proses</h2><div class="sub">Siapa PIC-nya dan apa langkah berikutnya</div>
        <div class="card tscroll"><table class="tbl cards"><thead><tr><th>Kios</th><th>Wilayah</th><th>Tahap saat ini</th><th>PIC</th><th>Status</th><th>Target buka</th><th>Langkah berikutnya</th><th>Update terakhir</th></tr></thead><tbody>
        ${inProc.length ? inProc.map((k) => `<tr><td data-l=""><b>${esc(k.nama)}</b><div class="note">${esc(k.kode)} · ${esc(k.alamat || "")}</div></td><td data-l="Wilayah">${esc(k.wilayahNama)}</td><td data-l="Tahap">${k.stage - 1}. ${esc(k.stageName)} <span class="note">(${k.daysInStage} hari)</span></td><td data-l="PIC"><span class="pill">${esc(k.stagePic)}</span></td><td data-l="Status"><span class="st ${k.statusKey}"><i></i>${esc(k.statusLabel)}</span>${flags(k)}</td><td data-l="Target buka">${fmtM(k.targetBuka)}</td><td data-l="Langkah berikutnya" class="note">${esc(k.nextStage)} · ${esc(k.nextPic)}</td><td data-l="Update terakhir" class="note">${fmtD(k.lastAt)}<br>${esc(k.lastNote)}</td></tr>`).join("") : `<tr><td colspan="8"><div class="empty">Belum ada kios dalam proses.</div></td></tr>`}</tbody></table></div></section>
      <section><h2><b>Kios</b> Beroperasi</h2><div class="sub">Hasil ekspansi yang sudah serah terima operasional</div>
        ${open.length ? open.map((k) => `<div class="rcard"><b>${esc(k.nama)} <span class="note">${esc(k.kode)}</span></b><div class="meta">${esc(k.wilayahNama)} · beroperasi sejak ${fmtD(k.openedAt)}</div></div>`).join("") : '<div class="empty">Belum ada kios yang beroperasi dari pipeline ini.</div>'}</section>
      <section><h2><b>Flow</b> & PIC Ekspansi</h2><div class="sub">Tahapan setiap kios setelah approval, beserta PIC yang bertanggung jawab</div>
        <div class="flow">${R.stages.filter((s) => s.i < 14).map((s) => `<div class="fb"><span class="no">${s.i - 1}</span>${esc(s.n)}<small>PIC: ${esc(s.pic)}${s.sla ? ` · SLA ${s.sla} hari` : ""}</small></div>`).join("")}</div>
        ${R.slaGroups ? `<div class="card" style="margin-top:12px"><b>SLA antar flow</b><div class="note" style="margin-bottom:6px">Batas waktu yang disepakati Tim Ekspansi per kelompok tahap; total ${R.slaGroups.reduce((a, g) => a + g.hari, 0)} hari kerja dari pengajuan DP sampai opening.</div>
        <table class="tbl"><thead><tr><th>Kelompok tahap</th><th>Tahap</th><th class="r">SLA (hari)</th></tr></thead><tbody>${R.slaGroups.map((g) => `<tr><td><b>${esc(g.nama)}</b></td><td class="note">${g.stages.map((i) => i - 1).join(", ")}</td><td class="r"><b>${g.hari}</b></td></tr>`).join("")}</tbody></table></div>` : ""}</section>
      <section><div class="row"><div><h2><b>Weekly</b> Update</h2><div class="sub">${R.weeklyAt ? "Terakhir dikirim " + fmtDT(R.weeklyAt) : "Teks siap kirim ke grup koordinasi"}</div></div><div class="sp"></div><button class="btn o s" id="bCopyW">Copy teks</button></div>
        <pre class="weekly" id="weekly">${esc(R.weeklyText)}</pre></section>`;
    $("bCopyW").onclick = () => navigator.clipboard?.writeText(R.weeklyText).then(() => toast("Teks disalin")).catch(() => toast("Pilih teks lalu salin manual", true));
  }

  boot();
})();
