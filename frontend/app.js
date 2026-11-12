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
  const direksiOnly = location.pathname.startsWith("/direksi");
  let token = localStorage.getItem("crk_token") || "";
  let me = null, S = null, R = null, D = null, mode = direksiOnly ? "dir" : (reportOnly ? "div" : "int");
  let filters = { wil: "", st: "", pic: "", mine: false, wSur: "", wSt: "", vFrom: "", vTo: "" };
  let pollTimer = null, fabBlocked = false, fabWanted = false;

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
    const shortLabels = { int: "Tim Ekspansi", div: "Reporting", dir: "Direksi" };
    const applyLabels = () => { if (window.innerWidth < 700) document.querySelectorAll("#modes button").forEach((b) => { b.dataset.full = b.dataset.full || b.textContent; b.textContent = shortLabels[b.dataset.m] || b.textContent; }); else document.querySelectorAll("#modes button").forEach((b) => { if (b.dataset.full) b.textContent = b.dataset.full; }); };
    applyLabels(); window.addEventListener("resize", applyLabels);
    // 3) FAB tidak menutupi Panel Admin: sembunyikan saat panel terlihat
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => { es.forEach((e) => { fabBlocked = e.isIntersecting; $("fab").classList.toggle("hide", fabBlocked || !fabWanted); }); }, { threshold: 0.05 });
      new MutationObserver(() => { const pn = $("panel"); if (pn && !pn._obs) { pn._obs = true; io.observe(pn); } }).observe(document.body, { childList: true, subtree: true });
    }
    $("ov").addEventListener("click", closeDr);
    $("fab").addEventListener("click", () => openKios());
    if (reportOnly || direksiOnly) { $("modes").classList.add("hide"); }
    await refresh();
    document.addEventListener("visibilitychange", () => { if (!document.hidden && (token || reportOnly || shareT)) refresh(true); });
    pollTimer = setInterval(() => { if (!document.hidden && !$("dr").classList.contains("on") && (token || reportOnly || direksiOnly || shareT)) refresh(true); }, mode === "dir" ? 30000 : 8000);
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    try { if (!reportOnly && !direksiOnly) location.hash = m === "div" ? "reporting" : m === "dir" ? "direksi" : "internal"; } catch (e) { }
    render();
    if ((m === "div" && !R) || (m === "dir" && !D) || m === "int") refresh(true);
    window.scrollTo(0, 0);
  }
  if (!reportOnly && !direksiOnly && location.hash === "#reporting") mode = "div";
  if (!reportOnly && !direksiOnly && location.hash === "#direksi") mode = "dir";

  let lastSig = "";
  const sigOf = (o) => { if (!o) return ""; const c = { ...o }; delete c.serverTime; delete c.today; return JSON.stringify(c); };
  const typing = () => { const a = document.activeElement; return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && a.type !== "checkbox"; };
  async function refresh(quiet) {
    try {
      if (direksiOnly || (!token && mode === "dir" && shareT)) {
        D = await api("/api/direksi?t=" + encodeURIComponent(shareT));
        setSync("ok", "Data per " + fmtDT(D.asOf));
        if (quiet) { const g = sigOf(D); if (g === lastSig) return; lastSig = g; } else lastSig = sigOf(D);
      } else if (reportOnly || (!token && mode === "div" && shareT)) {
        R = await api("/api/report?t=" + encodeURIComponent(shareT));
        setSync("ok", "Live · " + fmtDT(R.serverTime));
        if (quiet) { const g = sigOf(R); if (g === lastSig) return; lastSig = g; }
        else lastSig = sigOf(R);
      } else if (token) {
        S = await api("/api/state");
        me = S.me;
        if (mode === "div") R = await api("/api/report");
        if (mode === "dir") D = await api("/api/direksi");
        setSync("ok", "Live · " + fmtDT(S.serverTime));
        if (quiet) {
          const g = sigOf(S) + sigOf(R) + sigOf(D);
          if (g === lastSig || typing()) return; // tidak ada perubahan, atau user sedang mengetik
          lastSig = g;
        } else lastSig = sigOf(S) + sigOf(R) + sigOf(D);
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
    $("vLogin").classList.add("hide"); $("vInt").classList.add("hide"); $("vDiv").classList.add("hide"); $("vDir").classList.add("hide"); $("fab").classList.add("hide"); fabWanted = false;
    $("who").innerHTML = me ? `${esc(me.name)} · ${esc((S && S.roleLabel && S.roleLabel[me.role]) || me.role)} <button id="btnOut">Logout</button>` : "";
    if (me) $("btnOut").onclick = () => logout();
    if (direksiOnly) { $("vDir").classList.remove("hide"); renderDireksi(); return; }
    if (mode === "dir") {
      if (!token && !shareT) { $("vLogin").classList.remove("hide"); if (!wasLogin) renderLogin("Login untuk melihat Report Direksi, atau buka link dari Manager."); return; }
      $("vDir").classList.remove("hide"); renderDireksi(); return;
    }
    if (reportOnly) { $("vDiv").classList.remove("hide"); renderReport(); return; }
    if (mode === "div") {
      if (!token && !shareT) { $("vLogin").classList.remove("hide"); if (!wasLogin) renderLogin("Login untuk melihat Reporting, atau buka link laporan dari Admin."); return; }
      $("vDiv").classList.remove("hide"); renderReport(); return;
    }
    if (!token) { $("vLogin").classList.remove("hide"); if (!wasLogin) renderLogin(); return; }
    if (!S) return;
    $("vInt").classList.remove("hide"); renderInternal();
    fabWanted = canEdit() && window.innerWidth < 700;
    if (fabWanted && !fabBlocked) $("fab").classList.remove("hide");
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
      <h2><b>Login</b> Tracker</h2>${msg ? `<div class="note" style="margin-bottom:10px">${esc(msg)}</div>` : ""}
      <div class="tabs"><button data-t="masuk" class="${loginTab === "masuk" ? "on" : ""}">Login</button><button data-t="daftar" class="${loginTab === "daftar" ? "on" : ""}">Daftar</button><button data-t="admin" class="${loginTab === "admin" ? "on" : ""}">PIN Admin</button></div>
      <div id="loginBody"></div></div>`;
    v.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { loginTab = b.dataset.t; renderLogin(msg); }));
    const b = $("loginBody");
    if (loginTab === "masuk") {
      b.innerHTML = members.length ? `<div class="f"><div class="full"><label>Nama</label><select id="lMember">${members.map((m) => `<option value="${m.id}" data-haspin="${m.hasPin ? 1 : 0}">${esc(m.name)} — ${esc(roleLabel[m.role] || m.role)}${m.hasPin ? "" : " · PIN belum dibuat"}</option>`).join("")}</select></div>
        <div class="full"><label>PIN</label><input id="lPin" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 digit"><div class="note" id="lPinNote" style="margin-top:4px"></div></div></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="lGo">Login</button></div>` : `<div class="empty">Belum ada anggota. Daftar dulu — pendaftar pertama otomatis menjadi Admin.</div>`;
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
        <div class="row" style="margin-top:12px"><button class="btn" id="rGo">Daftar & login</button></div>
        <div class="note" style="margin-top:8px">${members.length ? "" : "Pendaftar pertama otomatis menjadi Admin."}</div>`;
      $("rGo").onclick = async () => {
        try { const d = await api("/api/auth/register", { method: "POST", body: { name: $("rName").value, role: $("rRole").value, pin: $("rPin").value, email: $("rEmail").value, phone: $("rPhone").value } }); onLogin(d); } catch (e) { toast(e.message, true); }
      };
    } else {
      b.innerHTML = `<div class="f"><div class="full"><label>PIN Admin</label><input id="aPin" type="password" inputmode="numeric" maxlength="6"></div></div><div class="row" style="margin-top:12px"><button class="btn" id="aGo">Login sebagai Admin</button></div><div class="note" style="margin-top:8px">PIN cadangan untuk admin (diatur di Panel Admin). Sesi 1 hari.</div>`;
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
  function flags(k) { let h = ""; if (k.tindak && k.tindak !== "followup") h += ` <span class="badge ${k.tindak === "hold" ? "w" : "m"}">${k.tindakLabel || k.tindak}</span>`; if (k.lewatSla) h += ` <span class="badge">SLA +${k.daysInStage - k.sla}h</span>`; else if (k.stalled) h += ` <span class="badge w">tanpa update ${k.daysInStage}h</span>`; if (k.lewatTarget) h += ` <span class="badge m">lewat target</span>`; return h; }

  // ------------------------------------------------------------ internal view
  function renderInternal() {
    const v = $("vInt");
    const act = S.kios.filter((k) => k.status !== "alternatif" && k.tindak !== "skip");
    const inProc = act.filter((k) => k.stage >= 2 && k.stage < 14);
    const mine = act.filter((k) => k.stage < 14 && k.tindak === "followup" && (stageOf(k.stage).roles.includes(me.role) || (me.role === "SPV" && k.stage === 1))).sort((a, b) => b.daysInStage - a.daysInStage);
    const wilNames = S.wilayah.map((w) => w.nama);
    const picRoles = ["SPV", "Surveyor", "SDO", "Legal", "Finance"];
    const roleLabel = S.roleLabel || {};
    v.innerHTML = `
    <section><h2><b>Ringkasan</b> Pipeline</h2><div class="sub">Angka otomatis dari data wilayah & kios</div>
      <div class="grid kpis">
        ${kpi(S.wilayah.filter((w) => !["selesai", "alternatif"].includes(w.status) && w.tindak === "followup").length, "Wilayah aktif", `dibagi / visit / pencarian · ${S.wilayah.filter((w) => w.tindak === "hold").length} hold · ${S.wilayah.filter((w) => w.tindak === "skip").length} skip`)}
        ${kpi(act.filter((k) => k.stage === 0).length, "Kandidat kios", "hasil pencarian surveyor")}
        ${kpi(act.filter((k) => k.stage === 1).length, "Menunggu approval", "PIC: SPV")}
        ${kpi(inProc.length, "Kios dalam proses", `${inProc.filter((k) => k.lewatSla).length} lewat SLA · ${inProc.filter((k) => k.tindak === "hold").length} hold`)}
        ${kpi(inProc.filter((k) => k.status === "blocked").length, "Blocked", "butuh eskalasi")}
        ${kpi(act.filter((k) => k.stage === 14).length, "Beroperasi", "sudah serah terima operasional")}
      </div></section>
    ${mine.length ? `<section><h2><b>Tugas</b> Saya</h2><div class="sub">Kios yang tahapnya menunggu role ${esc(me.role)}</div><div id="mine"></div></section>` : ""}
    <section><div class="row"><div><h2><b>Wilayah</b> & Pencarian</h2><div class="sub">Pembagian Wilayah → Visit → Pencarian Kios → Approval</div></div><div class="sp"></div>${canEdit() ? `<button class="btn s" id="bWil">+ Wilayah</button>` : ""}</div>
      <div class="row" style="margin-bottom:10px">
        <select id="fWSur" class="inl"><option value="">Semua surveyor</option>${S.members.filter((m) => m.role === "Surveyor" || S.wilayah.some((w) => w.surveyorId === m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.id}" ${m.id === filters.wSur ? "selected" : ""}>${esc(m.name)}</option>`).join("")}<option value="__none" ${filters.wSur === "__none" ? "selected" : ""}>Belum ada surveyor</option></select>
        <select id="fWSt" class="inl"><option value="">Semua status</option>${["dibagi", "visit", "cari", "alternatif", "selesai"].map((x) => `<option value="${x}" ${x === filters.wSt ? "selected" : ""}>${S.wilStatusLabel[x]}</option>`).join("")}<option disabled>── tindak lanjut ──</option>${["followup", "hold", "skip"].map((x) => `<option value="t:${x}" ${"t:" + x === filters.wSt ? "selected" : ""}>${S.tindakLabel[x]}</option>`).join("")}</select>
        <label style="display:flex;align-items:center;gap:4px;margin:0"><span class="note">Visit</span><input id="fVFrom" type="date" class="inl" style="width:150px" value="${filters.vFrom}"><span class="note">–</span><input id="fVTo" type="date" class="inl" style="width:150px" value="${filters.vTo}"></label>
        ${me.role === "Surveyor" ? `<label class="chip ${filters.wSur === me.id ? "on" : ""}" id="fWMine" style="margin:0">Wilayah saya</label>` : ""}
        ${(filters.wSur || filters.wSt || filters.vFrom || filters.vTo) ? `<button class="btn g s" id="fWReset">Reset filter</button>` : ""}
        <span class="note" id="fWCount"></span></div>
      <div class="card tscroll"><table class="tbl cards" id="tWil"></table></div></section>
    <section><div class="row"><div><h2><b>Pipeline</b> Kios</h2><div class="sub">Klik kartu untuk update stage, status, dan catatan</div></div><div class="sp"></div>${canEdit() ? `<button class="btn s" id="bKios">+ Kios</button>` : ""}</div>
      <div class="row" style="margin-bottom:10px">
        <select id="fWil" class="inl"><option value="">Semua wilayah</option>${wilNames.map((w) => `<option ${w === filters.wil ? "selected" : ""}>${esc(w)}</option>`).join("")}</select>
        <select id="fSt" class="inl"><option value="">Semua status</option>${["ontrack", "perhatian", "blocked", "hold", "skip", "alternatif", "selesai"].map((s) => `<option value="${s}" ${s === filters.st ? "selected" : ""}>${S.statusLabel[s]}</option>`).join("")}</select>
        <select id="fPic" class="inl"><option value="">Semua PIC</option>${picRoles.map((r) => `<option ${r === filters.pic ? "selected" : ""}>${r}</option>`).join("")}</select>
        <label class="chip ${filters.mine ? "on" : ""}" id="fMine" style="margin:0">Hanya tugas saya</label>
      </div>
      <div class="fases" id="fases"></div></section>
    ${me.isAdmin ? `<section><h2><b>Panel</b> Admin</h2><div class="sub">Anggota, settings, link laporan, import/export, job</div><div id="panel"></div></section>` : ""}`;
    if ($("bWil")) $("bWil").onclick = () => openWil();
    if ($("bKios")) $("bKios").onclick = () => openKios();
    $("fWil").onchange = (e) => { filters.wil = e.target.value; renderPipeline(); };
    $("fSt").onchange = (e) => { filters.st = e.target.value; renderPipeline(); };
    $("fPic").onchange = (e) => { filters.pic = e.target.value; renderPipeline(); };
    $("fMine").onclick = () => { filters.mine = !filters.mine; $("fMine").classList.toggle("on", filters.mine); renderPipeline(); };
    if (mine.length) $("mine").innerHTML = mine.slice(0, 8).map(card).join("");
    // wilayah table
    $("fWSur").onchange = (e) => { filters.wSur = e.target.value; renderInternal(); };
    $("fWSt").onchange = (e) => { filters.wSt = e.target.value; renderInternal(); };
    if ($("fWMine")) $("fWMine").onclick = () => { filters.wSur = filters.wSur === me.id ? "" : me.id; renderInternal(); };
    $("fVFrom").onchange = (e) => { filters.vFrom = e.target.value; renderInternal(); };
    $("fVTo").onchange = (e) => { filters.vTo = e.target.value; renderInternal(); };
    if ($("fWReset")) $("fWReset").onclick = () => { filters.wSur = ""; filters.wSt = ""; filters.vFrom = ""; filters.vTo = ""; renderInternal(); };
    const rows = S.wilayah.filter((w) => (!filters.wSur || (filters.wSur === "__none" ? !w.surveyorId : w.surveyorId === filters.wSur)) && (!filters.wSt || (filters.wSt.startsWith("t:") ? w.tindak === filters.wSt.slice(2) : w.status === filters.wSt))
      && (!filters.vFrom || (w.visitDate && w.visitDate >= filters.vFrom)) && (!filters.vTo || (w.visitDate && w.visitDate <= filters.vTo)))
      .sort((a, b) => (filters.vFrom || filters.vTo) ? (b.visitDate || "").localeCompare(a.visitDate || "") : a.nama.localeCompare(b.nama));
    $("fWCount").textContent = (filters.wSur || filters.wSt || filters.vFrom || filters.vTo) ? `${rows.length} dari ${S.wilayah.length} wilayah` : "";
    $("tWil").innerHTML = `<thead><tr><th>Wilayah</th><th>Kota</th><th>SPV</th><th>Surveyor</th><th>Status</th><th>Visit</th><th class="r">Kios</th><th>Catatan</th></tr></thead><tbody>` +
      (rows.length ? rows.map((w) => `<tr class="click" data-w="${w.id}"><td data-l=""><b>${esc(w.nama)}</b> <span class="note">${esc(w.cluster)}</span></td><td data-l="Kota">${esc(w.kota)}</td><td data-l="SPV">${esc(w.spvName) || "–"}</td><td data-l="Surveyor">${esc(w.surveyorName) || "–"}</td><td data-l="Status"><span class="pill ${w.status === "alternatif" ? "m" : ""}">${S.wilStatusLabel[w.status]}</span>${w.tindak !== "followup" ? ` <span class="badge ${w.tindak === "hold" ? "w" : "m"}">${S.tindakLabel[w.tindak]}</span>` : ""}</td><td data-l="Visit">${w.visitDate ? fmtD(w.visitDate) : '<span class="note">–</span>'}${(w.photos || []).length ? ` <span class="badge m">${w.photos.length} foto</span>` : (w.status !== "dibagi" && w.status !== "alternatif" ? ' <span class="badge w">tanpa foto</span>' : "")}</td><td data-l="Kios approved / target" class="r">${w.approvedCount} / ${w.targetKios || 1} <span class="note">(${w.kiosCount} kandidat)</span></td><td data-l="${w.catatan ? "Catatan" : ""}" class="note">${esc(w.catatan)}</td></tr>`).join("")
        : `<tr><td colspan="8"><div class="empty">${S.wilayah.length ? "Tidak ada wilayah yang cocok dengan filter." : 'Belum ada wilayah. Mulai dari "+ Wilayah" (langkah 1: Pembagian Wilayah oleh SPV).'}</div></td></tr>`) + `</tbody>`;
    $("tWil").querySelectorAll("tr[data-w]").forEach((tr) => (tr.onclick = () => openWil(tr.dataset.w)));
    renderPipeline();
    if (me.isAdmin) renderPanel();
    document.querySelectorAll(".kios[data-k]").forEach((c) => (c.onclick = () => openKios(c.dataset.k)));
  }

  function card(k) {
    const pct = Math.round((k.stage / 14) * 100);
    return `<div class="kios ${k.statusKey}" data-k="${k.id}"><b>${esc(k.nama)} <span class="note">${esc(k.kode)}</span></b><small>${esc(k.wilayahNama)} · ${esc(k.stageName)}</small><small>${k.stage === 14 ? `Buka ${fmtD(k.openedAt)} · target ${fmtM(k.targetBuka)}` : `PIC ${esc(k.stagePic)} · target ${fmtM(k.targetBuka)} · ${k.daysInStage} hari di tahap`}</small><div class="row" style="margin-top:4px;gap:6px">${stPill(k)}${flags(k)}</div><div class="prog"><i style="width:${pct}%"></i></div></div>`;
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
  function closeDr() { $("ov").classList.remove("on"); $("dr").classList.remove("on"); document.body.classList.remove("lock"); }
  function showDr(html) { $("dr").innerHTML = html; $("ov").classList.add("on"); $("dr").classList.add("on"); $("dr").scrollTop = 0; document.body.classList.add("lock"); }

  async function openKios(id) {
    const k = id ? S.kios.find((x) => x.id === id) : null;
    const d = k || { stage: 0, status: "ontrack", targetBuka: "", wilayahId: filters.wil ? (S.wilayah.find((w) => w.nama === filters.wil) || {}).id : "" };
    const st = stageOf(d.stage);
    const ro = !canEdit();
    const mayAdvance = k && k.stage < 14 && k.status !== "alternatif" && k.tindak === "followup" && (me.isAdmin || ["Manager", "SPV"].includes(me.role) || st.roles.includes(me.role));
    const mayBack = k && k.stage > 0 && (me.isAdmin || ["Manager", "SPV"].includes(me.role));
    showDr(`<div class="row"><h3>${k ? esc(k.nama) : "Kios baru"}</h3><div class="sp"></div><button class="btn g s" id="dClose">Tutup</button></div>
      <div class="note" style="margin:4px 0 10px">${k ? `${esc(k.kode)} · ${esc(k.stageName)} · PIC ${esc(k.stagePic)} · ${k.daysInStage} hari di tahap${k.sla ? ` (SLA ${k.sla} hari)` : ""} ${flags(k)}` : "Masukkan kandidat kios dari hasil pencarian (PIC Surveyor)"}</div>
      ${k ? `<div class="steps">${S.stages.map((s) => `<span class="${s.i < k.stage ? "done" : s.i === k.stage ? "cur" : ""}" title="${esc(s.n)}">${s.i + 1}</span>`).join("")}</div>` : ""}
      ${k && k.stage < 14 ? `<div class="card" style="padding:10px;margin-bottom:12px"><b>Next stage:</b> ${esc(k.nextStage)} <span class="pill">${esc(k.nextPic)}</span>
        <div class="row" style="margin-top:8px"><input id="sNote" class="inl" style="flex:1;min-width:160px" placeholder="Catatan update — wajib untuk Blocked / Perlu Perhatian / kembali / alternatif">
        ${mayAdvance ? `<button class="btn s" id="bNext">Next stage →</button>` : `<span class="note">${k.tindak !== "followup" ? `Kios sedang ${esc(k.tindakLabel)} — set Follow up untuk melanjutkan` : `Hanya ${esc(st.pic)} / SPV yang dapat memajukan stage`}</span>`}
        ${mayBack ? `<button class="btn o s" id="bBack">← Kembali</button>` : ""}</div>
        <div class="row" style="margin-top:8px"><select id="sStatus" class="inl"><option value="ontrack" ${k.status === "ontrack" ? "selected" : ""}>On Track</option><option value="perhatian" ${k.status === "perhatian" ? "selected" : ""}>Perlu Perhatian</option><option value="blocked" ${k.status === "blocked" ? "selected" : ""}>Blocked</option></select>
        ${!ro && k.status !== "alternatif" ? `<button class="btn o s" id="bStatus">Update status</button>` : ""}${k.status === "alternatif" ? `<button class="btn o s" id="bReopen">Reopen</button>` : (!ro ? `<button class="btn g s" id="bAlt">Jadikan alternatif</button>` : "")}</div>
        <div class="row" style="margin-top:8px"><span class="note" style="min-width:90px">Tindak lanjut</span><select id="sTindak" class="inl"><option value="followup" ${k.tindak === "followup" ? "selected" : ""}>Follow up</option><option value="hold" ${k.tindak === "hold" ? "selected" : ""}>Hold</option><option value="skip" ${k.tindak === "skip" ? "selected" : ""}>Skip</option></select>${!ro ? `<button class="btn o s" id="bTindak">Set</button>` : ""}${k.tindak !== "followup" ? `<span class="note">${esc(k.tindakLabel)} sejak ${fmtD(k.tindakAt)}${k.tindakNote ? " — " + esc(k.tindakNote) : ""}</span>` : ""}</div></div>` : ""}
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
      <div class="row" style="margin-top:12px">${!ro ? `<button class="btn" id="bSave">Simpan</button>` : ""}<div class="sp"></div>${k && me.isAdmin ? `<button class="btn g s" id="bDel">Delete</button>` : ""}</div>
      ${k ? `<div style="margin-top:14px"><b>Dokumen & foto</b><div class="note">SPK: ${k.spkFile ? `<a href="${esc(k.spkFile)}" target="_blank">${esc(k.spkFileName || "file SPK")}</a>` : "belum ada"} ${!ro ? `· <label style="display:inline;cursor:pointer;color:var(--red)">upload SPK<input type="file" id="fSpk" class="hide"></label>` : ""}</div>
        <div class="row" style="margin-top:6px">${(k.photos || []).map((p) => `<a href="${esc(p.url)}" target="_blank" class="pill ink">${esc(p.name || "foto")}</a>`).join("")}${!ro ? `<label class="pill" style="cursor:pointer">+ foto<input type="file" id="fPhoto" accept="image/*" capture="environment" class="hide"></label>` : ""}</div></div>
      <div style="margin-top:14px"><b>Riwayat update & komentar</b>
        <div class="row" style="margin-top:6px"><input id="cText" class="inl" style="flex:1" placeholder="Tulis komentar… (@nama untuk notifikasi email)"><button class="btn o s" id="bCm">Kirim</button></div>
        <div class="log" id="kLog"><div class="note">Memuat…</div></div></div>` : ""}`);
    $("dClose").onclick = closeDr;
    const collect = () => ({ nama: $("kNama").value.trim(), wilayahId: $("kWil").value, targetBuka: $("kTarget").value, alamat: $("kAlamat").value.trim(), mapsUrl: $("kMaps").value.trim(), luas: +$("kLuas").value || 0, sewaTahun: +$("kSewa").value || 0, dp: +$("kDp").value || 0, rabNilai: +$("kRab").value || 0, pemilikNama: $("kPemilik").value.trim(), pemilikHp: $("kPemilikHp").value.trim(), vendorNama: $("kVendor").value.trim(), renovasiPct: +$("kPct").value || 0, catatan: $("kNote").value.trim() });
    const save = async () => { const body = collect(); if (!body.nama) throw new Error("Nama kios wajib diisi"); if (!body.wilayahId) throw new Error("Pilih wilayah"); return k ? api(`/api/kios/${k.id}`, { method: "PUT", body }) : api("/api/kios", { method: "POST", body }); };
    const run = async (fn, ok) => { try { await fn(); toast(ok || "Tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } };
    if ($("bSave")) $("bSave").onclick = () => run(async () => { await save(); closeDr(); });
    if ($("bNext")) $("bNext").onclick = () => run(async () => { await save(); await api(`/api/kios/${k.id}/stage`, { method: "POST", body: { to: k.stage + 1, note: $("sNote").value } }); closeDr(); }, "Stage dimajukan");
    if ($("bBack")) $("bBack").onclick = () => run(async () => { await save(); await api(`/api/kios/${k.id}/stage`, { method: "POST", body: { to: k.stage - 1, note: $("sNote").value } }); closeDr(); }, "Stage dikembalikan");
    if ($("bTindak")) $("bTindak").onclick = () => run(async () => { await api(`/api/kios/${k.id}/tindak`, { method: "POST", body: { tindak: $("sTindak").value, note: $("sNote").value } }); closeDr(); }, "Tindak lanjut ter-update");
    if ($("bStatus")) $("bStatus").onclick = () => run(async () => { await api(`/api/kios/${k.id}/status`, { method: "POST", body: { status: $("sStatus").value, note: $("sNote").value } }); closeDr(); }, "Status ter-update");
    if ($("bAlt")) $("bAlt").onclick = () => run(async () => { const n = $("sNote").value; if (!n.trim()) throw new Error("Isi catatan alasan di kolom catatan dulu"); await api(`/api/kios/${k.id}/alternatif`, { method: "POST", body: { note: n } }); closeDr(); }, "Kios dijadikan alternatif");
    if ($("bReopen")) $("bReopen").onclick = () => run(async () => { await api(`/api/kios/${k.id}/alternatif`, { method: "POST", body: { note: "Dibuka kembali" } }); closeDr(); }, "Kios di-reopen");
    if ($("bDel")) $("bDel").onclick = () => confirmTwice("Delete kios ini? Tekan Delete lagi untuk konfirmasi.", () => run(async () => { await api(`/api/kios/${k.id}`, { method: "DELETE" }); closeDr(); }, "Terhapus"));
    if ($("bCm")) $("bCm").onclick = () => run(async () => { const t = $("cText").value.trim(); if (!t) return; await api(`/api/kios/${k.id}/comments`, { method: "POST", body: { text: t } }); $("cText").value = ""; loadTimeline(k.id); }, "Komentar terkirim");
    const up = (inputId, kind) => { const el = $(inputId); if (!el) return; el.onchange = () => run(async () => { const fd = new FormData(); fd.append("file", el.files[0]); await api(`/api/kios/${k.id}/files?kind=${kind}`, { method: "POST", body: fd }); closeDr(); }, "File ter-upload"); };
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
        <div><label>Tanggal visit <span class="note">(wajib bila sudah visit)</span></label><input id="wVisit" type="date" value="${esc(d.visitDate || "")}" ${ro ? "disabled" : ""}></div>
        <div class="full"><label>Catatan visit</label><textarea id="wVNote" ${ro ? "disabled" : ""}>${esc(d.visitNotes || "")}</textarea></div>
        <div class="full"><label>Catatan</label><textarea id="wNote" ${ro ? "disabled" : ""}>${esc(d.catatan || "")}</textarea></div>
      </div>
      ${w ? `<div class="card" style="padding:10px;margin-top:12px"><div class="row"><span class="note" style="min-width:90px">Tindak lanjut</span><select id="wTindak" class="inl" ${ro ? "disabled" : ""}><option value="followup" ${w.tindak === "followup" ? "selected" : ""}>Follow up</option><option value="hold" ${w.tindak === "hold" ? "selected" : ""}>Hold</option><option value="skip" ${w.tindak === "skip" ? "selected" : ""}>Skip</option></select><input id="wTNote" class="inl" style="flex:1;min-width:160px" placeholder="Alasan (wajib untuk Hold / Skip)">${!ro ? `<button class="btn o s" id="bWTindak">Set</button>` : ""}</div>${w.tindak !== "followup" ? `<div class="note" style="margin-top:4px">${esc(w.tindakLabel)} sejak ${fmtD(w.tindakAt)}${w.tindakNote ? " — " + esc(w.tindakNote) : ""}</div>` : ""}</div>` : ""}
      <div style="margin-top:12px"><b>Foto visit</b> <span class="note">— wajib minimal 1 foto sebelum status "Sudah visit"; foto lokasi, lalu lintas, kandidat kios</span>
        <div class="row" style="margin-top:6px" id="wPhotos">${(d.photos || []).map((p) => `<span class="ph"><a href="${esc(p.url)}" target="_blank"><img src="${esc(p.url)}" alt="${esc(p.name || "foto")}"></a>${!ro ? `<button class="phx" data-f="${p.id}" title="Hapus foto">×</button>` : ""}</span>`).join("")}
        ${!ro ? `<label class="pill" style="cursor:pointer">+ foto<input type="file" id="wFile" accept="image/*" capture="environment" multiple class="hide"></label>` : ""}</div>
        <div class="note" id="wPending"></div></div>
      <div class="row" style="margin-top:12px">${!ro ? `<button class="btn" id="bSave">Simpan</button>` : ""}${w && !ro && w.status !== "alternatif" ? `<button class="btn o" id="bAlt">Ganti wilayah alternatif</button>` : ""}<div class="sp"></div>${w && me.isAdmin ? `<button class="btn g s" id="bDel">Delete</button>` : ""}</div>
      <div id="altBox" class="hide card" style="margin-top:10px"><div class="f"><div><label>Nama wilayah alternatif</label><input id="aNama"></div><div><label>Kota</label><input id="aKota"></div><div class="full"><label>Alasan</label><input id="aNote"></div></div><div class="row" style="margin-top:8px"><button class="btn s" id="aGo">Buat wilayah alternatif</button></div></div>
      ${w ? `<div style="margin-top:14px"><b>Kios di wilayah ini</b>${S.kios.filter((k) => k.wilayahId === w.id).map(card).join("") || '<div class="note">Belum ada kandidat kios</div>'}</div>` : ""}`);
    $("dClose").onclick = closeDr;
    $("dr").querySelectorAll(".kios[data-k]").forEach((c) => (c.onclick = () => openKios(c.dataset.k)));
    const body = () => ({ nama: $("wNama").value.trim(), kota: $("wKota").value.trim(), cluster: $("wCl").value, status: $("wStatus").value, spvId: $("wSpv").value, surveyorId: $("wSur").value, targetKios: +$("wTarget").value || 1, targetBulan: $("wBulan").value, visitDate: $("wVisit").value, visitNotes: $("wVNote").value.trim(), catatan: $("wNote").value.trim() });
    const run = async (fn, ok) => { try { await fn(); toast(ok || "Tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } };
    let pending = [];
    const uploadTo = async (wid, files) => { for (const f of files) { const fd = new FormData(); fd.append("file", f); await api(`/api/wilayah/${wid}/files`, { method: "POST", body: fd }); } };
    if ($("wFile")) $("wFile").onchange = () => {
      const files = Array.from($("wFile").files || []); if (!files.length) return;
      if (w) run(async () => { await uploadTo(w.id, files); const fresh = await api("/api/state"); S = fresh; me = S.me; openWil(w.id); }, `${files.length} foto ter-upload`);
      else { pending = pending.concat(files); $("wPending").textContent = `${pending.length} foto akan di-upload saat Simpan`; }
    };
    $("dr").querySelectorAll(".phx").forEach((b) => (b.onclick = () => run(async () => { await api(`/api/wilayah/${w.id}/files/${b.dataset.f}`, { method: "DELETE" }); const fresh = await api("/api/state"); S = fresh; me = S.me; openWil(w.id); }, "Foto dihapus")));
    if ($("bSave")) $("bSave").onclick = () => run(async () => {
      const b = body(); if (!b.nama) throw new Error("Nama wilayah wajib diisi");
      const needPhoto = ["visit", "cari", "selesai"].includes(b.status);
      if (w) { await api(`/api/wilayah/${w.id}`, { method: "PUT", body: b }); }
      else {
        if (needPhoto && !pending.length) throw new Error("Lampirkan minimal 1 foto visit untuk status ini");
        if (needPhoto && !b.visitDate) throw new Error("Isi tanggal visit untuk status ini");
        const created = await api("/api/wilayah", { method: "POST", body: { ...b, status: "dibagi" } });
        if (pending.length) await uploadTo(created.id, pending);
        if (b.status !== "dibagi") await api(`/api/wilayah/${created.id}`, { method: "PUT", body: b });
      }
      closeDr();
    });
    if ($("bWTindak")) $("bWTindak").onclick = () => run(async () => { await api(`/api/wilayah/${w.id}/tindak`, { method: "POST", body: { tindak: $("wTindak").value, note: $("wTNote").value } }); closeDr(); }, "Tindak lanjut ter-update");
    if ($("bAlt")) $("bAlt").onclick = () => $("altBox").classList.toggle("hide");
    if ($("aGo")) $("aGo").onclick = () => run(async () => { await api(`/api/wilayah/${w.id}/alternatif`, { method: "POST", body: { namaAlternatif: $("aNama").value, kota: $("aKota").value, catatan: $("aNote").value } }); closeDr(); }, "Wilayah alternatif dibuat");
    if ($("bDel")) $("bDel").onclick = () => confirmTwice("Delete wilayah ini? Tekan Delete lagi untuk konfirmasi.", () => run(async () => { await api(`/api/wilayah/${w.id}`, { method: "DELETE" }); closeDr(); }, "Terhapus"));
  }

  // ------------------------------------------------------------ admin panel
  function renderPanel() {
    const s = S.settings;
    const link = location.origin + "/laporan?t=" + encodeURIComponent(s.shareToken || "");
    const linkDir = location.origin + "/direksi?t=" + encodeURIComponent(s.shareToken || "");
    $("panel").innerHTML = `
      <div class="card" style="margin-bottom:10px"><b>Link laporan All Divisi</b><div class="note" style="margin:4px 0 8px">Bagikan ke grup divisi lain — read-only, tanpa login, tanpa data sewa/DP/pemilik.</div>
        <div class="row"><input class="inl" style="flex:1;min-width:200px" value="${esc(link)}" readonly id="shareLink"><button class="btn o s" id="bCopyLink">Copy link</button><button class="btn g s" id="bRegen">Generate token baru</button></div>
        <div class="note" style="margin:10px 0 4px"><b>Link Report Direksi</b> — halaman visual untuk direksi (token sama, read-only, siap print/PDF).</div>
        <div class="row"><input class="inl" style="flex:1;min-width:200px" value="${esc(linkDir)}" readonly id="dirLink"><button class="btn o s" id="bCopyDir">Copy link</button></div></div>
      <div class="card" style="margin-bottom:10px"><b>Target pembukaan per bulan</b><div class="note" style="margin:4px 0 8px">Dipakai di Report Direksi (actual vs target). Kosong = tanpa target.</div>
        <div class="row">${monthsAhead().map((m) => `<label style="display:flex;align-items:center;gap:6px;margin:0"><span class="note" style="width:70px">${fmtM(m)}</span><input class="inl mt" data-m="${m}" type="number" min="0" style="width:64px" value="${(s.monthlyTarget || {})[m] ?? ""}"></label>`).join("")}</div>
        <div class="row" style="margin-top:8px"><button class="btn s" id="bSaveTgt">Simpan target</button></div></div>
      <div class="card" style="margin-bottom:10px"><b>Settings</b><div class="f" style="margin-top:8px">
        <div><label>Nama aplikasi</label><input id="sApp" value="${esc(s.appName)}"></div><div><label>Email admin (CC)</label><input id="sEmail" value="${esc(s.adminEmail || "")}"></div>
        <div><label>Daily digest (WIB)</label><input id="sDigest" value="${esc(s.dailyDigestTime)}" placeholder="17:00"></div><div><label>Nudge PIC (WIB)</label><input id="sNudge" value="${esc(s.nudgeTime)}" placeholder="09:00"></div>
        <div><label>Weekly update: hari (1=Senin)</label><input id="sWDay" type="number" min="1" max="7" value="${s.weeklyUpdateDay}"></div><div><label>Weekly update: jam</label><input id="sWTime" value="${esc(s.weeklyUpdateTime)}"></div>
        <div><label>Tandai "tanpa update" setelah (hari)</label><input id="sStalled" type="number" value="${s.stalledDays}"></div><div><label>PIN Admin baru (kosongkan bila tetap)</label><input id="sPin" inputmode="numeric" maxlength="6"></div>
        <div class="full"><label>SLA hari per tahap</label><div class="row">${S.stages.filter((x) => x.i >= 2 && x.i < 14).map((x) => `<label style="display:flex;align-items:center;gap:4px;margin:0"><span class="note" style="width:150px">${x.i - 1}. ${esc(x.n)}</span><input class="inl sla" data-i="${x.i}" type="number" style="width:64px" value="${(s.stageSla || {})[x.i] ?? ""}"></label>`).join("")}</div></div>
      </div><div class="row" style="margin-top:10px"><button class="btn" id="bSaveSet">Simpan settings</button></div></div>
      <div class="card" style="margin-bottom:10px"><b>Job & data</b><div class="row" style="margin-top:8px">
        <button class="btn o s" data-job="digest">Send daily digest</button><button class="btn o s" data-job="nudge">Send nudge PIC</button><button class="btn o s" data-job="weekly">Send Weekly Update</button><button class="btn o s" data-job="backup">Backup sekarang</button>
        <a class="btn g s" href="#" id="bExport">Export CSV</a><label class="btn g s" style="cursor:pointer">Import CSV<input type="file" id="fImport" accept=".csv" class="hide"></label>${S.kios.length ? "" : `<button class="btn g s" id="bSeed">Isi data contoh</button>`}</div>
        <div class="note" style="margin-top:6px">Kolom import: nama; wilayah; kota; cluster; alamat; tahap; status; targetBuka; sewaTahun; dp; vendor; catatan; tanggalUpdate. Email terkirim hanya bila SMTP/Resend diisi di environment.</div><div id="jobOut" class="note"></div></div>
      <div class="card"><div class="row"><b>Anggota</b><div class="sp"></div><button class="btn g s" id="bTeam">Tambah tim dari dokumen Flow</button></div><div style="margin-top:8px" id="members"></div></div>`;
    $("bCopyLink").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Link ter-copy")).catch(() => toast("Copy manual dari kolom", true));
    $("bCopyDir").onclick = () => navigator.clipboard?.writeText(linkDir).then(() => toast("Link ter-copy")).catch(() => toast("Copy manual dari kolom", true));
    $("bSaveTgt").onclick = () => { const t = { ...(s.monthlyTarget || {}) }; document.querySelectorAll(".mt").forEach((i) => { if (i.value === "") delete t[i.dataset.m]; else t[i.dataset.m] = +i.value; }); saveSettings({ monthlyTarget: t }); };
    $("bRegen").onclick = () => confirmTwice("Token lama akan mati. Tekan lagi untuk konfirmasi.", () => saveSettings({ regenerateShareToken: true }));
    $("bSaveSet").onclick = () => { const sla = {}; document.querySelectorAll(".sla").forEach((i) => { if (i.value) sla[i.dataset.i] = +i.value; }); saveSettings({ appName: $("sApp").value, adminEmail: $("sEmail").value, dailyDigestTime: $("sDigest").value, nudgeTime: $("sNudge").value, weeklyUpdateDay: +$("sWDay").value, weeklyUpdateTime: $("sWTime").value, stalledDays: +$("sStalled").value, stageSla: sla, adminPin: $("sPin").value || undefined }); };
    document.querySelectorAll("[data-job]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/jobs/${b.dataset.job}/run`, { method: "POST" }); $("jobOut").textContent = JSON.stringify(r).slice(0, 400); toast("Job dijalankan"); } catch (e) { toast(e.message, true); } b.disabled = false; }));
    $("bExport").onclick = async (e) => { e.preventDefault(); try { const r = await fetch("/api/export.csv", { headers: { Authorization: "Bearer " + token } }); const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "expansion-tracker.csv"; a.click(); } catch (e2) { toast("Gagal export", true); } };
    $("fImport").onchange = async () => { const fd = new FormData(); fd.append("file", $("fImport").files[0]); try { const r = await api("/api/import", { method: "POST", body: fd }); toast(`Import: ${r.kiosBaru} kios, ${r.wilayahBaru} wilayah baru`); refresh(true); } catch (e) { toast(e.message, true); } };
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
  async function saveSettings(body) { try { await api("/api/settings", { method: "PUT", body }); toast("Settings tersimpan"); await refresh(true); } catch (e) { toast(e.message, true); } }

  // ------------------------------------------------------------ reporting view
  function renderReport() {
    const v = $("vDiv");
    if (!R) { v.innerHTML = `<div class="empty" style="margin-top:20px">${shareT || token ? "Loading laporan…" : "Link laporan tidak valid."}</div>`; return; }
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
    $("bCopyW").onclick = () => navigator.clipboard?.writeText(R.weeklyText).then(() => toast("Teks ter-copy")).catch(() => toast("Pilih teks lalu copy manual", true));
  }

  // ------------------------------------------------------------ report direksi (SVG charts, brand palette)
  function monthsAhead() { const out = []; const d = new Date(); d.setDate(1); for (let i = 0; i < 6; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() + 1); } return out; }
  const RED = "#B42F27", TINT = "#E0BFB1", INK = "#212121", MUTED = "#6B625A", LINE = "#D9CDB8";
  function svgBars(rows, opts) {
    // rows: [{label, a, b, mark}] a = primary bar, b = secondary bar (optional), mark = line marker (optional)
    const W = opts.w || 640, H = opts.h || 220, pl = 36, pr = 12, pt = 16, pb = opts.pb || 44;
    const n = rows.length, mx = Math.max(1, ...rows.flatMap((r) => [r.a || 0, r.b || 0, r.mark || 0]));
    const cw = (W - pl - pr) / n, bw = Math.min(28, cw * (opts.b ? 0.32 : 0.55));
    const y = (v) => pt + (H - pt - pb) * (1 - v / mx);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:${H}px;font-family:inherit">`;
    const ticks = mx <= 5 ? mx : 5;
    for (let i = 0; i <= ticks; i++) { const v = Math.round((mx / ticks) * i * 10) / 10; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${LINE}" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="10" fill="${MUTED}" text-anchor="end">${v}</text>`; }
    rows.forEach((r, i) => {
      const cx = pl + cw * i + cw / 2;
      if (opts.b) {
        g += `<rect x="${cx - bw - 2}" y="${y(r.a || 0)}" width="${bw}" height="${y(0) - y(r.a || 0)}" fill="${r.muted ? TINT : RED}" rx="3"/>`;
        g += `<rect x="${cx + 2}" y="${y(r.b || 0)}" width="${bw}" height="${y(0) - y(r.b || 0)}" fill="${TINT}" rx="3"/>`;
        if (r.a != null) g += `<text x="${cx - 2 - bw / 2}" y="${y(r.a || 0) - 4}" font-size="11" font-weight="700" fill="${INK}" text-anchor="middle">${r.a}</text>`;
        if (r.b) g += `<text x="${cx + 2 + bw / 2}" y="${y(r.b) - 4}" font-size="10" fill="${MUTED}" text-anchor="middle">${r.b}</text>`;
      } else {
        g += `<rect x="${cx - bw / 2}" y="${y(r.a || 0)}" width="${bw}" height="${y(0) - y(r.a || 0)}" fill="${r.over ? RED : (r.muted ? TINT : RED)}" rx="3"/>`;
        if (r.a != null) g += `<text x="${cx}" y="${y(r.a || 0) - 4}" font-size="11" font-weight="700" fill="${INK}" text-anchor="middle">${r.a}</text>`;
      }
      if (r.mark != null) g += `<line x1="${cx - cw * 0.42}" x2="${cx + cw * 0.42}" y1="${y(r.mark)}" y2="${y(r.mark)}" stroke="${INK}" stroke-width="2" stroke-dasharray="4 3"/>`;
      const lab = String(r.label).split("\n");
      lab.forEach((t, li) => { g += `<text x="${cx}" y="${H - pb + 14 + li * 12}" font-size="10" fill="${r.isCurrent ? RED : MUTED}" font-weight="${r.isCurrent ? 700 : 400}" text-anchor="middle">${esc(t)}</text>`; });
    });
    g += `</svg>`;
    return g;
  }
  function legend(items) { return `<div class="row" style="gap:14px;font-size:11px;color:var(--muted);margin-top:4px">${items.map((i) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${i.c};vertical-align:-1px;margin-right:4px;${i.dash ? "background:none;border-top:2px dashed " + INK + ";height:0;vertical-align:3px" : ""}"></i>${i.l}</span>`).join("")}</div>`; }
  function renderDireksi() {
    const v = $("vDir");
    if (!D) { v.innerHTML = `<div class="empty" style="margin-top:20px">${shareT || token ? "Loading report…" : "Link tidak valid."}</div>`; return; }
    const sm = D.summary;
    const curIdx = D.monthly.findIndex((m) => m.isCurrent);
    const monthlyRows = D.monthly.map((m) => ({ label: m.label.replace(" ", "\n"), a: m.actual, b: m.actual == null ? m.planned : null, mark: m.target || null, isCurrent: m.isCurrent }));
    const faseRows = D.fases.map((f) => ({ label: f.fase, a: f.count }));
    const clRows = D.clusters.map((c) => ({ label: c.cluster.replace(" ", "\n"), a: c.beroperasi, b: c.proses }));
    const speedRows = D.stageSpeed.map((s) => ({ label: `${s.stage - 1}\n${s.short}`, a: s.avg, mark: s.sla || null, over: s.avg != null && s.sla && s.avg > s.sla, muted: s.avg == null }));
    const ytdOpen = D.monthly.filter((m) => m.actual != null && m.month.slice(0, 4) === D.month.slice(0, 4)).reduce((a, m) => a + (m.actual || 0), 0);
    v.innerHTML = `
      <div class="dirhead">
        <div><div class="note" style="letter-spacing:.14em;text-transform:uppercase;font-weight:700">CRK Group · Expansion</div><h2 style="font-size:30px"><b>Report</b> Direksi — ${esc(D.monthLabel)}</h2><div class="note">Data per ${fmtDT(D.asOf)} · sumber: Expansion Tracker (input harian Tim Ekspansi)</div></div>
        <div class="row noprint"><button class="btn o s" id="bPrint">Print / simpan PDF</button><button class="btn o s" id="bCopyHl">Copy ringkasan</button></div>
      </div>
      <section style="margin-top:14px"><div class="grid kpis">
        ${kpi(sm.beroperasi, "Kios beroperasi", `${ytdOpen} dibuka tahun ${D.month.slice(0, 4)}`)}
        ${kpi(sm.dalamProses, "Dalam proses", `${sm.kontrak} kontrak · ${sm.renovasi} renovasi · ${sm.serahTerima} serah terima`)}
        ${kpi(`${sm.bukaBulanIni}<span style="font-size:16px;color:var(--muted)"> / ${(D.monthly[curIdx] || {}).target || "–"}</span>`, "Buka bulan ini vs target", `${sm.targetBulanIni} kios lagi ditargetkan ${esc(D.monthLabel)}`)}
        ${kpi(D.leadTimeAvg != null ? `${D.leadTimeAvg}<span style="font-size:16px;color:var(--muted)"> hari</span>` : "–", "Rata-rata DP → buka", `SLA ${D.slaTotal} hari · ${D.leadTimeN} kios selesai`)}
        ${kpi(D.slaCompliance != null ? D.slaCompliance + "%" : "–", "Perpindahan tahap dalam SLA", `${D.slaSamples} perpindahan tahap dinilai`)}
        ${kpi(sm.blocked + sm.lewatSla, "Perlu keputusan", `${sm.blocked} blocked · ${sm.lewatSla} lewat SLA`)}
      </div></section>
      <section><h2><b>Highlights</b></h2><div class="sub">Ringkasan untuk direksi</div>
        <div class="card">${D.highlights.map((h) => `<div class="callout" style="margin-top:8px;border-top:0;padding-top:0;font-weight:500">${esc(h)}</div>`).join("")}</div></section>
      <div class="dirgrid">
        <section><h2><b>Pembukaan</b> per Bulan</h2><div class="sub">Actual vs target; bulan mendatang menampilkan kios yang direncanakan buka</div>
          <div class="card">${svgBars(monthlyRows, { b: true, h: 230 })}${legend([{ c: RED, l: "Kios buka (actual)" }, { c: TINT, l: "Direncanakan buka (pipeline)" }, { dash: true, l: "Target bulanan" }])}</div></section>
        <section><h2><b>Pipeline</b> per Fase</h2><div class="sub">Kios approved yang sedang berjalan</div>
          <div class="card">${svgBars(faseRows, { h: 230 })}<div class="note" style="margin-top:4px">Kandidat belum approved: ${sm.kandidat + sm.menungguApproval} kios (${sm.menungguApproval} menunggu approval SPV).</div></div></section>
        <section><h2><b>Sebaran</b> per Cluster</h2><div class="sub">Beroperasi vs dalam proses</div>
          <div class="card">${D.clusters.length ? svgBars(clRows, { b: true, h: 230 }) + legend([{ c: RED, l: "Beroperasi" }, { c: TINT, l: "Dalam proses" }]) : '<div class="empty">Belum ada data</div>'}</div></section>
        <section><h2><b>Kecepatan</b> per Tahap</h2><div class="sub">Rata-rata hari per tahap (selesai) vs SLA; merah penuh = melewati SLA</div>
          <div class="card">${svgBars(speedRows, { h: 250, w: 760, pb: 40 })}${legend([{ c: RED, l: "Rata-rata hari" }, { dash: true, l: "SLA" }])}
          <div class="note" style="margin-top:6px">${D.stageSpeed.some((s) => !s.samples) ? "Tahap tanpa batang = belum ada kios yang menyelesaikan tahap itu." : ""}</div></div></section>
      </div>
      <section><h2><b>Perhatian</b> Direksi</h2><div class="sub">Kios blocked, melewati SLA, atau melewati target buka — butuh keputusan/dukungan lintas divisi</div>
        <div class="card tscroll"><table class="tbl cards"><thead><tr><th>Kios</th><th>Wilayah</th><th>Tahap</th><th>PIC</th><th>Kondisi</th><th>Target buka</th><th>Catatan terakhir</th></tr></thead><tbody>
        ${D.attention.length ? D.attention.map((k) => `<tr><td data-l=""><b>${esc(k.nama)}</b> <span class="note">${esc(k.kode)}</span></td><td data-l="Wilayah">${esc(k.wilayahNama)}</td><td data-l="Tahap">${k.stage - 1}. ${esc(k.stageName)} <span class="note">(${k.daysInStage} hari)</span></td><td data-l="PIC"><span class="pill">${esc(k.stagePic)}</span></td><td data-l="Kondisi"><span class="st ${k.statusKey}"><i></i>${esc(k.statusLabel)}</span>${flags(k)}</td><td data-l="Target">${fmtM(k.targetBuka)}</td><td data-l="Catatan" class="note">${esc(k.lastNote)}</td></tr>`).join("") : `<tr><td colspan="7"><div class="empty">Tidak ada kios yang membutuhkan perhatian khusus.</div></td></tr>`}</tbody></table></div></section>
      <section><h2><b>Target</b> Buka Terdekat</h2><div class="sub">Kios yang ditargetkan buka bulan ini dan bulan depan</div>
        <div class="card tscroll"><table class="tbl cards"><thead><tr><th>Kios</th><th>Wilayah</th><th>Target buka</th><th>Tahap saat ini</th><th>Sisa tahap</th><th>Status</th></tr></thead><tbody>
        ${D.upcoming.length ? D.upcoming.map((k) => `<tr><td data-l=""><b>${esc(k.nama)}</b> <span class="note">${esc(k.kode)}</span></td><td data-l="Wilayah">${esc(k.wilayahNama)}</td><td data-l="Target">${fmtM(k.targetBuka)}</td><td data-l="Tahap">${k.stage - 1}. ${esc(k.stageName)}</td><td data-l="Sisa tahap">${14 - k.stage} tahap</td><td data-l="Status"><span class="st ${k.statusKey}"><i></i>${esc(k.statusLabel)}</span></td></tr>`).join("") : `<tr><td colspan="6"><div class="empty">Tidak ada kios dengan target buka dua bulan ini.</div></td></tr>`}</tbody></table></div></section>
      <div class="note" style="margin-top:16px">Definisi: Beroperasi = serah terima operasional selesai. Dalam proses = approved s.d. serah terima. SLA per tahap sesuai kesepakatan Tim Ekspansi (total ${D.slaTotal} hari). Hari dihitung hari kalender.</div>`;
    $("bPrint").onclick = () => window.print();
    $("bCopyHl").onclick = () => navigator.clipboard?.writeText(`REPORT DIREKSI EKSPANSI — ${D.monthLabel}\n\n` + D.highlights.map((h) => "• " + h).join("\n")).then(() => toast("Ringkasan ter-copy")).catch(() => toast("Copy manual", true));
  }

  boot();
})();
