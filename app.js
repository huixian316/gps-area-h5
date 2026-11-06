'use strict';
/* ============================================================
 * GPS 测面积 · 应用逻辑（纯前端，无后端、无数据库、无账号体系）
 * 数据仅存于本设备浏览器 localStorage，跨设备不共享、不同步、不上传。
 * ============================================================ */

/* ============================================================
 * 底图配置：默认 OpenStreetMap，无需任何 API Key，打开即用。
 * 更换底图（含带 Key 的商业瓦片）→ 见 README.md「更换底图」。
 * 安全提示：若使用带 Key 的瓦片，不要把真实 Key 提交到公开仓库。
 * ============================================================ */
const BASEMAPS = {
  osm: {
    name: 'OpenStreetMap（默认，免 Key）',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 贡献者',
    maxZoom: 19,
  },
  carto: {
    name: 'CARTO 浅色（免 Key 备选）',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap 贡献者 &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  custom: {
    name: '自定义底图（编辑本文件填写 url / attribution / maxZoom）',
    url: '',        // 示例（Mapbox）：'https://api.mapbox.com/styles/v1/{username}/{styleId}/tiles/{tilesize}/{z}/{x}/{y}?access_token=YOUR_TOKEN'
    attribution: '',
    maxZoom: 19,
  },
};
const ACTIVE_BASEMAP = 'osm';

/* ============================================================
 * 核心面积计算（六步实现，供页面计算表与单元测试共用）
 * ============================================================ */
// >>> AREA-CORE-START
// WGS84 椭球参数（用参考点处的椭球曲率半径做局部投影，精度高于平均球体半径法）
const WGS84_A  = 6378137.0;                 // 长半轴 a（米）
const WGS84_E2 = 6.6943799901413165e-3;     // 第一偏心率平方 e²
const R_EARTH  = 6371008.8;                 // 平均地球半径（米），仅用于 haversine 距离去重

/**
 * 计算多边形面积。
 * 输入：points —— [{lat, lon}, ...] WGS84 经纬度（度），至少 3 点。
 * 输出：null（点不足）或包含六步全部中间量的对象（供逐项计算表展示）。
 */
function computeAreaDetail(pts) {
  const n = pts.length;
  if (n < 3) return null;

  /* ---------- 步骤 1：取参考点 φ0、λ0 ----------
   * 取多边形第 1 个顶点作为局部平面坐标系的原点（参考点）。 */
  const lat0 = pts[0].lat;
  const lon0 = pts[0].lon;

  /* ---------- 步骤 2：经纬度转弧度 ----------
   * 度 → 弧度：rad = deg · π / 180。参考点与全部顶点都要转换。 */
  const phi0 = lat0 * Math.PI / 180;          // 参考点纬度 φ0（弧度）
  const lam0 = lon0 * Math.PI / 180;          // 参考点经度 λ0（弧度）
  const phi  = pts.map(p => p.lat * Math.PI / 180);  // 各顶点纬度（弧度）
  const lam  = pts.map(p => p.lon * Math.PI / 180);  // 各顶点经度（弧度）

  /* ---------- 步骤 3：局部平面投影（单位：米，WGS84 椭球曲率半径） ----------
   * M(φ0) = a·(1−e²) / (1−e²·sin²φ0)^{3/2}   —— 子午线曲率半径（南北方向）
   * N(φ0) = a / (1−e²·sin²φ0)^{1/2}          —— 卯酉圈曲率半径（东西方向）
   * x_i = N(φ0)·cos(φ0)·(λ_i − λ0) ：经度差 × 参考点纬度圈曲率半径
   * y_i = M(φ0)·(φ_i − φ0)         ：纬度差 × 子午线曲率半径
   * cos φ0 修正“经度 1° 实际长度随纬度缩短”的畸变；用椭球曲率半径替代平均
   * 球体半径 R，可消除最高约 0.3% 的系统性尺度偏差（球体法即 M=N=R 的特例），
   * 剩余误差仅为二阶小量 O((d/R)²)。 */
  const sin2 = Math.sin(phi0) ** 2;
  const w = 1 - WGS84_E2 * sin2;
  const M = WGS84_A * (1 - WGS84_E2) / (w * Math.sqrt(w));   // 子午线曲率半径（米）
  const N = WGS84_A / Math.sqrt(w);                          // 卯酉圈曲率半径（米）
  const cosPhi0 = Math.cos(phi0);
  const kX = N * cosPhi0;                           // 比例系数 N·cosφ0（东向）
  const kY = M;                                     // 比例系数 M（北向）
  const x = lam.map(l => kX * (l - lam0));          // 东向坐标（米）
  const y = phi.map(f => kY * (f - phi0));          // 北向坐标（米）

  /* ---------- 步骤 4 + 5：格林公式离散形式，并首尾闭合 ----------
   * A = ½ · | Σ_{i=0}^{n-1} ( x_i·y_{i+1} − x_{i+1}·y_i ) |
   * 下标按模 n 回卷：j = (i+1) % n。当 i = n−1 时 j = 0，
   * 末边自动连回第 1 个点（首尾闭合），无需手动复制首点。 */
  const terms = [];      // 每一项的中间量，供计算表逐行展示
  let S = 0;             // 有向面积和 Σ(x_i·y_j − x_j·y_i)
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;                              // 步骤 5：首尾闭合
    const a = x[i] * y[j];                              // x_i·y_j
    const b = x[j] * y[i];                              // x_j·y_i
    const cross = a - b;                                // 该边贡献
    cum += cross;
    S = cum;
    terms.push({ i, j, a, b, cross, cum });
  }
  const areaM2 = 0.5 * Math.abs(S);                     // 步骤 4：A = ½|S|

  /* ---------- 步骤 6：单位换算 ----------
   * 1 公顷 = 10⁴ m²；1 亩 = 2000/3 m²；1 km² = 10⁶ m²。 */
  const areaHa  = areaM2 / 10000;
  const areaMu  = areaM2 * 3 / 2000;
  const areaKm2 = areaM2 / 1e6;

  /* 附：周长（同一局部投影下的折线长度，含闭合边），仅作辅助信息。 */
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeter += Math.hypot(x[j] - x[i], y[j] - y[i]);
  }

  return { n, lat0, lon0, phi0, lam0, cosPhi0, kX, kY, M, N,
           x, y, terms, S, areaM2, areaHa, areaMu, areaKm2, perimeter };
}
// <<< AREA-CORE-END

/* ============================================================
 * 常量、状态、工具函数
 * ============================================================ */
const LS_CUR  = 'gpsArea.current.v1';
const LS_SESS = 'gpsArea.sessions.v1';
const AUTO_STEP_M  = 5;    // 自动记录：距上一顶点至少移动 5 m 才加点
const AUTO_MAX_ACC = 20;   // 自动记录：精度半径劣于 20 m 的定位不采纳
const DUP_M        = 0.5;  // 手动加点：与上一顶点 < 0.5 m 视为重复

let points = [];           // 顶点：{lat, lon, acc, t, src}
let sessions = loadSessions();
let manualMode = false, autoMode = false;
let gpsWatchId = null, lastFix = null, pannedToFix = false;
let map, drawLayer, fixLayer;

const $ = id => document.getElementById(id);
const toR = Math.PI / 180;
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 2) => v.toLocaleString('zh-CN', {minimumFractionDigits: 0, maximumFractionDigits: d});

function haversineM(a, b) {          // 两 WGS84 点间大圆距离（米），用于去重/自动记录
  const dPhi = (b.lat - a.lat) * toR, dLam = (b.lon - a.lon) * toR;
  const s = Math.sin(dPhi / 2) ** 2 +
            Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLam / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ============================================================
 * localStorage（仅本设备，无后端）
 * ============================================================ */
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_SESS)) || []; } catch { return []; }
}
function persistSessions() {
  try { localStorage.setItem(LS_SESS, JSON.stringify(sessions)); } catch { /* 存储满时静默 */ }
}
function persistCurrent() {
  try {
    localStorage.setItem(LS_CUR, JSON.stringify({ points, unit: $('unitSel').value }));
  } catch { /* ignore */ }
}
function restoreCurrent() {
  try {
    const cur = JSON.parse(localStorage.getItem(LS_CUR));
    if (cur && Array.isArray(cur.points)) {
      points = cur.points.filter(p => isFinite(p.lat) && isFinite(p.lon));
      if (cur.unit) $('unitSel').value = cur.unit;
    }
  } catch { /* ignore */ }
}

/* ============================================================
 * 地图
 * ============================================================ */
function initMap() {
  if (typeof L === 'undefined') {
    $('map').innerHTML = '<div class="map-fail">Leaflet 库加载失败：本页地图资源来自公共 CDN，请联网后刷新。</div>';
    return false;
  }
  map = L.map('map');
  let cfg = BASEMAPS[ACTIVE_BASEMAP] || BASEMAPS.osm;
  if (!cfg.url) {                      // custom 槽位未填写时回退到 OSM
    cfg = BASEMAPS.osm;
    setTimeout(() => toast('自定义底图未配置 url，已回退到 OpenStreetMap'), 800);
  }
  const tiles = L.tileLayer(cfg.url, {
    maxZoom: cfg.maxZoom, attribution: cfg.attribution,
    subdomains: cfg.subdomains || 'abc',
  }).addTo(map);
  // 瓦片加载失败提示：离线/网络受限时无底图，但测量功能不受影响
  let tileErr = 0;
  tiles.on('tileerror', () => {
    if (++tileErr === 4 && !document.getElementById('tileNotice')) {
      const n = document.createElement('div');
      n.id = 'tileNotice';
      n.className = 'tile-notice';
      n.textContent = '底图瓦片加载失败（离线或网络受限）。无底图模式下测量与计算功能不受影响。';
      map.getContainer().appendChild(n);
    }
  });
  drawLayer = L.layerGroup().addTo(map);
  fixLayer  = L.layerGroup().addTo(map);
  map.setView([36.2, 105.5], 4);
  map.on('click', e => {
    if (!manualMode) return;
    addPoint({ lat: e.latlng.lat, lon: e.latlng.lng, acc: null, t: Date.now(), src: 'manual' });
  });
  return true;
}

function redrawMap() {
  if (!map) return;
  drawLayer.clearLayers();
  if (!points.length) return;
  const ll = points.map(p => [p.lat, p.lon]);

  if (points.length >= 3)   // 填充面（自动闭合，仅作视觉提示，不参与计算）
    L.polygon(ll, { stroke: false, fillColor: '#0d7a5f', fillOpacity: .15 }).addTo(drawLayer);
  if (points.length >= 2)   // 实线：实际走过的折线
    L.polyline(ll, { color: '#0d7a5f', weight: 2 }).addTo(drawLayer);
  if (points.length >= 3)   // 虚线：首尾闭合边（对应算法第 5 步）
    L.polyline([ll[ll.length - 1], ll[0]], { color: '#0d7a5f', weight: 2, dashArray: '6 6', opacity: .8 }).addTo(drawLayer);

  points.forEach((p, i) => {
    const ref = i === 0;    // 第 1 点即参考点 (φ0, λ0)
    L.circleMarker([p.lat, p.lon], {
      radius: ref ? 8 : 6, color: '#fff', weight: 2,
      fillColor: ref ? '#e8590c' : '#0d7a5f', fillOpacity: 1
    }).addTo(drawLayer)
     .bindTooltip(ref ? '1 · 参考点 φ₀,λ₀' : String(i + 1),
                  { permanent: true, direction: 'top', className: 'vtx-tip' + (ref ? ' ref' : '') });
  });
}

function fitToPoints() {
  if (!map || !points.length) return;
  map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])).pad(0.3), { maxZoom: 17 });
}

/* ============================================================
 * 渲染：结果条 + 逐项计算表
 * ============================================================ */
function renderResult() {
  const d = computeAreaDetail(points);
  const unit = $('unitSel').value;
  if (!d) {
    $('areaValue').textContent = '—';
    $('areaSub').textContent = '走一圈边界或点图放置 ≥3 个顶点后自动计算';
    $('areaMeta').textContent = `顶点 ${points.length} · 周长 —`;
    return;
  }
  const digits = { m2: 1, mu: 2, ha: 3, km2: 6 }[unit];
  const val = { m2: d.areaM2, mu: d.areaMu, ha: d.areaHa, km2: d.areaKm2 }[unit];
  $('areaValue').textContent = fmt(val, digits);
  $('areaSub').textContent =
    `≈ ${fmt(d.areaM2, 1)} m² · ${fmt(d.areaMu, 2)} 亩 · ${fmt(d.areaHa, 3)} 公顷 · ${fmt(d.areaKm2, 6)} km²`;
  const per = d.perimeter > 1000 ? fmt(d.perimeter / 1000, 2) + ' km' : fmt(d.perimeter, 1) + ' m';
  $('areaMeta').textContent = `顶点 ${d.n} · 周长 ${per}（周长含首尾闭合边）`;
}

function renderTable() {
  const d = computeAreaDetail(points);
  const pane = $('pane-table');
  if (!d) {
    pane.innerHTML = '<div class="cardbox empty">顶点不足 3 个：先绕地块记录至少 3 个角点。</div>';
    return;
  }
  const rows = d.terms.map(t => `
    <tr>
      <td><button class="del" data-i="${t.i}" title="删除顶点 ${t.i + 1}">✕</button></td>
      <td>${t.i + 1}</td>
      <td>${points[t.i].lat.toFixed(6)}</td>
      <td>${points[t.i].lon.toFixed(6)}</td>
      <td>${fmt(d.x[t.i], 2)}</td>
      <td>${fmt(d.y[t.i], 2)}</td>
      <td>${fmt(t.a, 2)}</td>
      <td>${fmt(t.b, 2)}</td>
      <td>${fmt(t.cross, 2)}</td>
      <td>${fmt(t.cum, 2)}</td>
      <td>${t.j === 0 ? '→ 1 ⟲' : '→ ' + (t.j + 1)}</td>
    </tr>`).join('');

  pane.innerHTML = `
    <div class="const-box cardbox">
      <b>步骤1 参考点</b>（取第 1 顶点）：φ₀ = ${points[0].lat.toFixed(7)}°，λ₀ = ${points[0].lon.toFixed(7)}°<br>
      <b>步骤2 弧度</b>：φ₀ = ${d.phi0.toFixed(7)} rad，λ₀ = ${d.lam0.toFixed(7)} rad<br>
      <b>步骤3 系数</b>（WGS84 椭球曲率半径）：cos φ₀ = ${d.cosPhi0.toFixed(6)}，M = ${fmt(d.M, 2)} m，N = ${fmt(d.N, 2)} m，N·cos φ₀ = ${fmt(d.kX, 2)} m
    </div>
    <div class="muted" style="font-size:12px;margin:2px 2px 6px">
      逐项表：j = (i+1) mod n（首尾闭合），每行 = x<sub>i</sub>y<sub>j</sub> − x<sub>j</sub>y<sub>i</sub>，末行自动连回第 1 点
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th></th><th>#</th><th>纬度 φ (°)</th><th>经度 λ (°)</th>
          <th>x<sub>i</sub> (m)</th><th>y<sub>i</sub> (m)</th>
          <th>x<sub>i</sub>·y<sub>j</sub></th><th>x<sub>j</sub>·y<sub>i</sub></th>
          <th>项 = x<sub>i</sub>y<sub>j</sub> − x<sub>j</sub>y<sub>i</sub></th><th>累计 Σ</th><th>闭合 j</th>
        </tr></thead>
        <tbody>${rows}
          <tr class="sumrow">
            <td colspan="2"></td>
            <td colspan="7" style="text-align:right">S = Σ ( x<sub>i</sub>y<sub>j</sub> − x<sub>j</sub>y<sub>i</sub> ) =</td>
            <td>${fmt(d.S, 2)}</td><td>⟲</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="concl cardbox">
      <b>步骤4+5：</b>A = ½·|S| = ½·|${fmt(d.S, 2)}| = <b>${fmt(d.areaM2, 2)} m²</b><br>
      <b>步骤6：</b>≈ ${fmt(d.areaHa, 4)} 公顷 · ${fmt(d.areaMu, 2)} 亩 · ${fmt(d.areaKm2, 6)} km²
      （顶点增删后以新首点为参考点全表重算）
    </div>`;

  pane.querySelector('tbody').addEventListener('click', e => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    points.splice(+btn.dataset.i, 1);
    render(false);
    toast('已删除顶点，参考点与全表已重算');
  });
}

function render(fit = false) {
  redrawMap();
  renderResult();
  renderTable();
  persistCurrent();
  if (fit) fitToPoints();
}

/* ============================================================
 * 顶点操作
 * ============================================================ */
function addPoint(p) {
  const last = points[points.length - 1];
  if (last && haversineM(last, p) < DUP_M) { toast('新点与上一顶点相距不足 0.5 m，已忽略'); return; }
  points.push(p);
  render(false);
  toast(`已记录顶点 #${points.length}${p.acc != null ? `（精度 ±${Math.round(p.acc)} m）` : ''}`);
}

/* ============================================================
 * GPS（WGS84，浏览器 Geolocation；仅 HTTPS 或本机调试环境可用）
 * ============================================================ */
function setBadge(cls, text) {
  const b = $('gpsBadge');
  b.className = 'badge' + (cls === 'ok' ? ' ok' : cls === 'search' ? ' searching' : cls === 'err' ? ' err' : '');
  b.textContent = text;
}

function toggleGps() {
  if (gpsWatchId !== null) {                       // 停止
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null; lastFix = null;
    fixLayer.clearLayers();
    $('chipGps').classList.remove('on');
    setBadge('', '定位未开启');
    return;
  }
  if (!('geolocation' in navigator)) { toast('此浏览器不支持 Geolocation'); return; }
  if (!window.isSecureContext) toast('当前页面非 HTTPS，浏览器已禁用定位；请通过 HTTPS 地址访问');
  setBadge('search', '定位中…');
  gpsWatchId = navigator.geolocation.watchPosition(onFix, onGpsErr,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

function onFix(pos) {
  lastFix = pos;
  const c = pos.coords;
  setBadge('ok', `已锁定 ±${Math.round(c.accuracy)} m`);
  $('chipGps').classList.add('on');
  fixLayer.clearLayers();
  L.circleMarker([c.latitude, c.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: '#1976d2', fillOpacity: 1 })
    .addTo(fixLayer).bindTooltip('当前位置');
  L.circle([c.latitude, c.longitude], { radius: c.accuracy, color: '#1976d2', weight: 1, opacity: .5, fillOpacity: .08 })
    .addTo(fixLayer);
  if (!pannedToFix) { map.setView([c.latitude, c.longitude], 17); pannedToFix = true; }
  if (autoMode && c.accuracy <= AUTO_MAX_ACC) {
    const last = points[points.length - 1];
    if (!last || haversineM(last, { lat: c.latitude, lon: c.longitude }) >= AUTO_STEP_M)
      addPoint({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: pos.timestamp, src: 'gps' });
  }
}

function onGpsErr(e) {
  const why = { 1: '权限被拒绝', 2: '位置不可用', 3: '定位超时' }[e.code] || e.message;
  setBadge('err', '定位失败：' + why);
  if (e.code === 1) toast('定位权限被拒绝：请在浏览器设置中允许本站点使用位置信息');
}

/* ============================================================
 * 历史记录（localStorage，仅本设备）
 * ============================================================ */
function renderHistory() {
  const ul = $('histList');
  if (!sessions.length) {
    ul.innerHTML = '<li class="empty">暂无保存的测量（数据只存在本设备）</li>';
    return;
  }
  ul.innerHTML = sessions.map(s => {
    const d = computeAreaDetail(s.points || []);
    const t = new Date(s.savedAt);
    const when = `${t.getMonth() + 1}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return `<li>
      <div class="h-info"><b>${esc(s.name)}</b>
        <span>${d ? fmt(d.areaM2, 1) + ' m² · ' + fmt(d.areaMu, 2) + ' 亩' : '顶点不足'} · ${(s.points || []).length} 点 · ${when}</span></div>
      <div class="h-ops">
        <button data-act="load" data-id="${s.id}">载入</button>
        <button data-act="del" data-id="${s.id}" class="danger">删除</button>
      </div></li>`;
  }).join('');
}

function onSave() {
  if (points.length < 3) { toast('至少 3 个顶点才能保存'); return; }
  const name = $('nameInput').value.trim() ||
    `地块 ${new Date().getMonth() + 1}-${String(new Date().getDate()).padStart(2, '0')} ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  sessions.unshift({ id: Date.now(), name, savedAt: new Date().toISOString(), points: JSON.parse(JSON.stringify(points)) });
  if (sessions.length > 50) sessions.length = 50;   // 上限 50 条，防 localStorage 膨胀
  persistSessions(); renderHistory();
  $('nameInput').value = '';
  toast('已保存到本设备浏览器');
}

function onHistClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = +btn.dataset.id;
  if (btn.dataset.act === 'del') {
    sessions = sessions.filter(s => s.id !== id);
    persistSessions(); renderHistory(); toast('已删除该记录');
    return;
  }
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  if (points.length && !confirm('载入将覆盖当前未保存的顶点，继续？')) return;
  points = JSON.parse(JSON.stringify(s.points));
  render(true);
  switchTab('table');
  toast(`已载入「${s.name}」`);
}

/* ============================================================
 * UI 绑定与启动
 * ============================================================ */
function switchTab(name) {
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
}

function bindUI() {
  document.querySelectorAll('.tabbtn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  $('chipGps').onclick = toggleGps;
  $('chipManual').onclick = () => {
    manualMode = !manualMode;
    $('chipManual').classList.toggle('on', manualMode);
    $('chipManual').textContent = '点图加点：' + (manualMode ? '开' : '关');
    if (map) map.getContainer().style.cursor = manualMode ? 'crosshair' : '';
    if (manualMode) toast('已开启点图加点：点击地图放置顶点（演示/无GPS 时用）');
  };
  $('chipAuto').onclick = () => {
    autoMode = !autoMode;
    $('chipAuto').classList.toggle('on', autoMode);
    $('chipAuto').textContent = '自动记录：' + (autoMode ? '开' : '关');
    if (autoMode) {
      if (gpsWatchId === null) toggleGps();          // 自动记录隐含开启定位
      toast('自动记录已开启：沿边界行走，每移动 ≥5 m 自动加点');
    }
  };

  $('btnAdd').onclick = () => {
    if (!lastFix) { toast('暂无定位结果：请先点右上角「◉ 定位」'); return; }
    const c = lastFix.coords;
    addPoint({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: lastFix.timestamp, src: 'gps' });
  };
  $('btnUndo').onclick = () => {
    if (!points.length) return toast('没有可撤销的顶点');
    points.pop(); render(false); toast('已撤销上一顶点');
  };
  $('btnClear').onclick = () => {
    if (!points.length) return;
    if (!confirm(`清空当前全部 ${points.length} 个顶点？`)) return;
    points = []; render(false); toast('已清空');
  };

  $('unitSel').onchange = () => { renderResult(); persistCurrent(); };
  $('btnSave').onclick = onSave;
  $('histList').addEventListener('click', onHistClick);
  $('btnWipeHist').onclick = () => {
    if (!sessions.length) return;
    if (!confirm('清空全部历史记录？此操作不可恢复。')) return;
    sessions = []; persistSessions(); renderHistory(); toast('历史已清空');
  };
}

function init() {
  restoreCurrent();
  if (initMap()) bindUI();
  renderHistory();
  render(points.length > 0);
}
init();
