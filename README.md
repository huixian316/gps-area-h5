# GPS 测面积 · H5（纯静态）

用浏览器 GPS（WGS84）绕地块一圈测面积的纯静态工具：Leaflet 地图 + 局部投影 + 格林公式离散形式（鞋带公式）求面积，页面内展示公式与逐项计算表。

**无后端、无数据库、无云函数、无账号体系、无 API Key（默认底图免 Key）。** 每台设备的数据只存在该设备浏览器的 localStorage，不上传、不跨设备同步。

## 功能

- GPS 定位记录顶点（`watchPosition`，高精度），或「自动记录」沿边行走每 ≥5 m 自动加点；桌面端可用「点图加点」演示
- 面积六步算法：参考点 → 转弧度 → 局部投影 `x=R·cosφ₀·(λ−λ₀), y=R·(φ−φ₀)` → 格林公式离散 `A=½|Σ(xᵢyⱼ−xⱼyᵢ)|` → 模 n 首尾闭合 → 单位换算（m²/亩/公顷/km²）
- 逐项计算表：每个顶点的 φ/λ、x/y、两个乘积项、叉积、累计 Σ、闭合列，可逐行核对
- 数学说明独立页：[math.html](math.html)（完整推导、手算示例、反例、精度分析）
- 历史记录保存/载入/删除（仅本设备）
- 响应式：手机竖屏、平板、电脑宽屏同一套页面
- 无底图降级：瓦片加载失败时提示，测量与计算不受影响

## 目录结构

```
index.html    页面结构
style.css     样式（响应式）
app.js        全部逻辑（含六步面积算法与底图配置）
math.html     数学说明（独立页）
README.md     本文件
.nojekyll     GitHub Pages 跳过 Jekyll 处理（空文件，保留）
```

无构建步骤，整个文件夹可直接作为任意静态托管的站点根目录。

## 本地打开

- **推荐**（GPS 可用）：任意静态服务器，例如
  `python -m http.server 8000`，然后访问 `http://localhost:8000/`。
  localhost 属浏览器安全上下文，电脑上定位可用。
- **直接双击 index.html（file://）**：页面可看、可点图加点，但浏览器禁止 file:// 页面使用 Geolocation，且部分浏览器还会拦截 CDN 资源，不建议。
- 手机在局域网访问电脑：`http://<电脑局域网IP>:8000`（HTTP 非 HTTPS，手机上定位不可用，仅能点图加点；电脑防火墙需放行对应端口）。

## 一键部署（任选其一，全部免费额度即可）

部署后自动获得 HTTPS 公网链接，手机/电脑浏览器直接打开，定位可用。

| 平台 | 方式 |
|---|---|
| **GitHub Pages** | 新建仓库 → 把本文件夹**内容**作为仓库根目录上传 → Settings → Pages → Source 选分支 `main` / 目录 `/ (root)` → 保存。约 1 分钟后得到 `https://<用户名>.github.io/<仓库名>/` |
| **Netlify** | 打开 [app.netlify.com/drop](https://app.netlify.com/drop)，把本文件夹拖进去，秒得 `https://xxx.netlify.app`；或 CLI：`npx netlify-cli deploy --dir . --prod` |
| **Cloudflare Pages** | Dashboard → Workers & Pages → Create → Pages → Upload assets，拖入本文件夹；或 CLI：`npx wrangler pages deploy .` |
| **Vercel** | [vercel.com/new](https://vercel.com/new) 导入仓库（Framework Preset 选 Other，无需构建命令）；或 CLI：`npx vercel --prod` |

无需任何环境变量或构建设置。更新页面 = 重新上传/推送同名文件。

## HTTPS 与定位

- 浏览器规定 **Geolocation 仅在 HTTPS（或 localhost）下可用**。以上平台默认提供 HTTPS 证书，部署后定位功能天然可用；切勿用 HTTP 外链分享。
- 首次使用浏览器会询问位置权限，请选择「允许」。
- 手机定位建议在室外开阔处，精度一般 1～5 m； iOS Safari 要求页面保持前台。

## 更换底图（app.js 顶部 `BASEMAPS`）

默认 `ACTIVE_BASEMAP = 'osm'`（OpenStreetMap 瓦片，**免 Key**）。切换/新增底图只需改这个配置对象：

```js
const BASEMAPS = {
  osm:   { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap 贡献者', maxZoom: 19 },
  carto: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', ... },   // 免 Key 备选
  custom:{ url: '', attribution: '', maxZoom: 19 },   // 自己填
};
```

- **带 Key 的商业底图**（Mapbox、Maptiler 等）：把含 `access_token=YOUR_TOKEN` 的模板填进 `custom.url`。
  ⚠️ 前端 Key 必然暴露在页面里，请只使用带域名防盗链限制的 token，且**不要把真实 Key 提交到公开仓库**（部署前替换、或放到私有配置再合并）。
- **高德/腾讯/百度瓦片警告**：其瓦片为 GCJ-02/BD-09 坐标系，与 GPS 的 WGS84 在中国大陆相差数百米，直接使用会导致轨迹整体偏移，必须先做坐标转换，本项目默认不含。
- `custom.url` 留空时会自动回退到 OSM 并提示。

## 瓦片来源与使用限制

- 默认瓦片：[OpenStreetMap](https://www.openstreetmap.org) 公共瓦片服务，遵循[瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)——个人小流量使用没问题；禁止大规模抓取/高并发调用；页面已按要求显示 © OpenStreetMap 版权与归属。
- 备选瓦片：CARTO Basemaps（同样基于 OSM 数据，免 Key，亦有公平使用限制）。
- Leaflet 库（v1.9.4）来自 unpkg CDN，首次打开需联网；若需完全离线，可下载 Leaflet 放入本目录 `lib/` 并改用相对路径引用。

## 跨设备与数据隔离

- 所有数据（当前顶点、历史记录、单位偏好）仅存于**当前设备当前浏览器**的 localStorage，键名 `gpsArea.current.v1` / `gpsArea.sessions.v1`。
- 不同电脑/手机之间**不共享、不同步、不上传**；换设备打开看到的是空记录，这是正常现象。
- 清除浏览器站点数据会删除记录，重要测量结果请截图或抄录。
- 无登录/注册/邀请码/鉴权：任何人拿到链接即可用，数据各自本地保存。

## 精度声明

手机 GPS 误差通常 1～5 m（树荫/屋檐下更差），几十平方米的小地块相对误差会明显放大；建议绕行多圈取平均、在角点处稍作停留。算法本身的投影误差在地块尺度（数公里内）可忽略，推导见 [math.html](math.html)。
