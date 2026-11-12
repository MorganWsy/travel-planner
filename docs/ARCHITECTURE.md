# 行迹（travel-planner）架构说明

基线日期：2026-11-12。本文描述**当前仓库实际实现**，不是未来方案。产品目标与阶段计划见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)，接口契约见 [API_CONTRACT.md](API_CONTRACT.md)，实际差异与验证记录见 [DELIVERY.md](DELIVERY.md)。

## 1. 一句话理解

“行迹”是一个以**多日行程**为核心的单体 Web 应用：用户在同一个工作台里维护地点库、每日事项、交通和时间线，地图负责空间定位与标注；每次内容修改都会生成可回看的 revision 快照，导出、分享和历史都从同一份快照生成。

当前形态是**模块化单体 + 同代码库任务处理器**：

- 一个 FastAPI 后端（同步路由，数据库事务 + 进程内线程池任务）。
- 一个 React 单页前端（Vite 构建，MapLibre 地图，Ant Design 组件）。
- 一个 PostgreSQL/PostGIS 数据库（业务数据 + 空间几何 + 历史快照 + 任务状态）。
- 本机开发时不依赖 Redis、对象存储、Nginx 或 Docker。

## 2. 运行时拓扑

### 2.1 当前开发环境

```text
浏览器
  │  http://localhost:5177
  ▼
Vite dev server ── /api 代理 ──► Uvicorn :8007 ── SQLAlchemy ──► PostgreSQL 17 / PostGIS 3
  │                                  │
  │                                  ├─ providers（高德 / 天地图，httpx）
  │                                  ├─ ThreadPoolExecutor（优化 / 导出）
  │                                  └─ data/exports（导出文件）
  └─ MapLibre 直接请求高德/天地图瓦片
```

- Vite 只负责前端资源与 `/api` 代理，生产构建产物在 `apps/web/dist`。
- FastAPI 在 `apps/web/dist` 存在时会挂载静态资源，并把非 `/api` 路径回退到 `index.html`，因此也可以由后端直接托管前端。
- 数据库连接、会话密钥、SMTP、供应商 Key 从环境变量 / `.env` 读取，示例见 `apps/api/.env`（不提交）。
- 导出文件落在 `data/exports/<job_id>/`，数据库只保存路径与元数据。

### 2.2 方案中的目标部署（尚未落地）

`docs/IMPLEMENTATION_PLAN.md` 规划的是同域 Nginx + API + Worker + PostgreSQL/PostGIS + Redis/RQ + 私有文件存储。当前 `infra/` 为空，没有 Compose、Nginx、Redis/RQ 或 Alembic 迁移。升级与容器化建议见 [UPGRADE_ASSESSMENT.md](UPGRADE_ASSESSMENT.md)。

## 3. 仓库目录与职责

```text
travel-planner/
  apps/api/
    app/
      main.py              FastAPI 装配、中间件、异常处理、SPA 回退
      config.py            Pydantic Settings，环境变量与默认值
      db.py                Engine / Session / Base / utcnow
      deps.py              认证、CSRF、If-Match、限流、归属校验
      models.py            SQLAlchemy 领域模型
      schemas.py           Pydantic 请求/响应模型（OpenAPI 来源）
      security.py          口令散列、会话令牌、CSRF 派生
      routers/             按资源拆分的 HTTP 层
      services/            领域服务（时间线、优化、导出、快照、任务）
      providers/           高德/天地图适配器、能力注册表、用途策略
  apps/web/
    src/
      api/                 fetch 封装、手写 API 方法、OpenAPI 生成类型
      pages/               路由页面
      components/          地图、日程、搜索、图层、通用控件
      store/               Zustand（认证、工作台选择、连线样式）
      theme/               Ant Design 主题 token
      lib/                 坐标转换、通知等
  config/
    provider_policy.json   供应商字段用途策略
  scripts/                 建库、OpenAPI 导出、示例数据
  tests/                   pytest（纯逻辑 + PostgreSQL 集成）
  docs/                    方案、契约、验收、架构、升级、核实记录
  data/                    本地运行数据（忽略）
```

## 4. 后端架构

### 4.1 请求链路

```text
HTTP 请求
  → CORSMiddleware（仅本地开发端口）
  → attach_request_id（生成/透传 X-Request-ID；/api 响应 no-store）
  → 路由依赖（get_auth / require_csrf / get_owned_trip / check_revision）
  → router 函数
  → service（事务、快照、时间线、优化、导出）
  → SQLAlchemy / PostGIS
  → Pydantic 响应模型
```

统一错误由 `AppError` 转成：

```json
{"error": {"code": "...", "message": "...", "request_id": "...", "details": {}}}
```

字段校验失败统一转成 422 `VALIDATION_ERROR`。越权访问统一返回 404，避免枚举资源。

### 4.2 路由分组

所有业务接口前缀为 `/api/v1`，共约 60 条：

| 路由模块 | 主要职责 |
| --- | --- |
| `misc.py` | 健康检查、公开配置、供应商能力、CSV/GeoJSON 导入 |
| `auth.py` | 滑块挑战、邮箱验证码、注册、登录、会话、改密、会话撤销、资料 |
| `settings.py` | 地图 Key 的读取/保存/测试、出口 IP 检测（管理员） |
| `trips.py` | 行程 CRUD、复制、日期变更预览/应用、每日设置、天气、revision、恢复 |
| `places.py` | 地点新建/修改/删除（支持级联解除引用） |
| `stops.py` | 事项新建/修改/删除、跨天重排 |
| `routes.py` | 地图搜索/建议/详情/地理编码/天气、路线查询、手工交通、时间线 |
| `layers.py` | 专题点图层、要素、POI 采集、GeoJSON 导出 |
| `optimization.py` | 优化任务创建、结果应用 |
| `jobs.py` | 任务列表、详情、结果、取消、重试 |
| `exports.py` | 攻略预览、导出任务、历史成果、下载 |
| `shares.py` | 分享创建/列表/撤销、公开读取/解锁/复制 |

### 4.3 服务层分工

| 服务 | 作用 |
| --- | --- |
| `trip_content.py` | 读取/序列化行程；构建快照；`commit()` 统一递增 revision；恢复与复制 |
| `timeline.py` | 按“交通 → 等待开放 → 停留”顺推，产出时间线、冲突、确定/不确定状态 |
| `optimize.py` | 单日 2-opt / Or-opt 启发式，支持固定预约、时间窗、锁定项；估算/高德矩阵 |
| `runners.py` | 任务处理器：`optimization` 与 `export` |
| `jobs.py` | 任务落库、幂等、线程池提交、状态/进度/错误更新 |
| `guide.py` | 从 revision 快照生成攻略，渲染 Markdown / DOCX |
| `geostore.py` | WKB ↔ GeoJSON，PostGIS 几何读写唯一入口 |
| `coords.py` / `geo.py` | WGS84 ↔ GCJ-02、Haversine 距离等 |
| `timeutil.py` | IANA 时区、local time → UTC、跨日处理 |
| `app_settings.py` | 实例级设置（地图 Key）加密存储与运行期覆盖 |
| `mailer.py` | SMTP 发信；未配置时只写日志并返回 `dev=true` |
| `egress.py` | 检测服务器出口 IP，辅助天地图 IP 白名单配置 |

### 4.4 供应商适配层

- `providers/base.py`：统一 `Capability`、`GeoItem`、`RouteResult`、`RateGate`、`HttpProvider`。上游字段只允许出现在适配器内部。
- `providers/amap.py`：高德 Web 服务；输入/输出涉及 GCJ-02 时在适配器/坐标服务内转换。
- `providers/tianditu.py`：天地图服务端搜索/地理编码/路径；瓦片 Key 与服务器 Key 分开。
- `providers/registry.py`：运行期 Key 覆盖、适配器缓存、能力汇总。
- `providers/policy.py` + `config/provider_policy.json`：按能力声明 `display_on_custom_map / persist / share / export / offline / retain_reference / compute` 的 allowed/denied/unknown。

关键原则：没有 Key 返回 `PROVIDER_NOT_CONFIGURED`，不伪造空结果；预览结果不自动入库；路线几何是否可持久化由策略决定。当前默认策略下，供应商路线几何为 `persist=unknown`，只进入本次会话的 `displayRoutes`，不写数据库、快照、导出或分享。

### 4.5 数据模型

所有主键为 UUID 字符串；时间戳为 UTC `timestamptz`；金额为整数分；坐标统一 `[longitude, latitude]`。

| 实体 | 作用 | 关键关系/约束 |
| --- | --- | --- |
| `users` | 账号、角色、头像色、邮箱验证时间 | email 唯一 |
| `sessions` | 服务端不透明会话 | 只存 token 哈希；有 TTL / 空闲过期 |
| `captcha_challenges` | 滑块挑战 | 一次性、过期时间 |
| `email_codes` | 邮箱验证码 | 只存哈希；一次性 + 重发限流 |
| `trips` | 行程主表 | owner；revision；软删除 `deleted_at` |
| `trip_days` | 每日起止时间、起终点、备注 | `(trip_id, date)` 唯一 |
| `places` | 行程内地点库 | `geometry` / `navigation_geometry` 均为 `POINT,4326` |
| `trip_stops` | 每日事项或候选池 | `day_id=null` 即候选池；position 排序 |
| `route_legs` | 交通段 | 可关联 stop/place；geometry 为 `LINESTRING,4326`；策略决定是否可存 |
| `map_layers` | 专题点图层（我的/系统） | 跟随行程；系统图层不可删除 |
| `map_layer_features` | 图层内点要素 | `POINT,4326` |
| `trip_revisions` | 全量行程快照 | `(trip_id, revision)` 唯一；`snapshot` JSON |
| `shares` | 只读分享 | 钉住 revision；token/password 只存哈希；可撤销/过期 |
| `jobs` | 后台任务状态机 | queued/running/succeeded/failed/cancelled；幂等键 |
| `exports` | 导出成果 | 关联 job/trip/revision；7 天过期；私有路径 |
| `operation_events` | 操作审计 | 不含地点正文、Key 或原始响应 |
| `datasets` | 导入数据登记 | 当前仅点数据；栅格/MVT 未实现 |
| `app_settings` | 实例设置 | 地图 Key 整体 JSON，密钥字段加密 |

### 4.6 版本与事务模型

这是本项目最重要的后端约束：

1. 所有内容写接口要求 `If-Match: "<revision>"`；缺失 428，版本不匹配 409。
2. 事务内 `SELECT ... FOR UPDATE` 锁住 trip 行，校验 revision。
3. 先 flush 内容变更，再递增 `trip.revision`。
4. 读取当前完整内容，写入 `trip_revisions.snapshot`。
5. 同一事务提交。

因此历史、分享、导出都从 `trip_revisions` 取同一条快照，不会出现“当前行程已改、导出还是旧内容”的不一致。恢复历史不是改旧快照，而是把快照写回当前表并生成**新 revision**。

> 当前快照包含 days / places / stops / route_legs，不包含 map_layers。专题图层只在所有者工作台的 `TripDetail` 中返回；分享页使用 `GuideSnapshot`，因此当前分享不展示图层。这是已知差异，见 [DELIVERY.md](DELIVERY.md)。

### 4.7 任务模型

`services/jobs.py` 用数据库表 + 进程内 `ThreadPoolExecutor(max_workers=2)` 实现：

- 创建任务先落库（`queued`），再提交线程池。
- 执行中更新 `status/progress/stage`，失败写 `error`。
- 支持 `Idempotency-Key` 复用、取消标志、重试新建任务。
- 导出写入 `data/exports/<job_id>/`，下载时重新校验归属、任务状态、过期时间与行程未删除。

替换为 Redis/RQ 时，`services/jobs.py::submit()` 是主要替换点，路由和状态字段不需要变。

## 5. 前端架构

### 5.1 入口与路由

`src/main.tsx` 负责：

- `BrowserRouter`、`QueryClientProvider`、Ant Design `ConfigProvider`（中文 locale + 明暗主题）。
- dayjs 中文 locale 与 `customParseFormat`。
- 引入 MapLibre CSS 与全局 `styles.css`。
- `NotifyBridge` 把 Ant Design message/notification 接到统一通知层。

`src/App.tsx` 路由：

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/login`、`/register` | 登录/注册 | 滑块 + 邮箱验证码 |
| `/` | 我的行程 | 受保护 |
| `/trips/:tripId` | 工作台 | 地图 + 左右侧栏 |
| `/trips/:tripId/history` | 历史版本 | 只读快照、恢复 |
| `/trips/:tripId/guide` | 攻略预览 | 与导出一致的内容 |
| `/settings` | 设置 | 数据源/外观/账号/会话/关于 |
| `/s/:token` | 只读分享 | 公开，可密码解锁、可复制 |

工作台、历史、攻略、分享、设置均通过 `React.lazy` 按路由拆分，首屏不加载 MapLibre。

### 5.2 状态分层

| 状态 | 存放位置 | 例子 |
| --- | --- | --- |
| 服务端状态 | TanStack Query | 行程详情、公开配置、任务、分享 |
| 跨组件 UI 状态 | Zustand | 当前用户、选中 stop/place、当前日期、底图、连线样式 |
| 页面内临时状态 | `useState` / `useRef` | 弹窗、草稿、地图实例、测距点、预览路线 |

原则：地图实例、Marker、Popup 等命令式对象放 `useRef`；不要放进 Zustand，避免序列化和重渲染问题。供应商临时路线只放 `WorkspacePage` 的 `displayRoutes`，不进入 Query 缓存持久层。

### 5.3 地图层

`components/MapCanvas.tsx` 是最大的前端组件，职责包括：

- 创建 MapLibre 地图，切换高德矢量/影像、天地图、空白底板。
- 把地点渲染为 GeoJSON circle + symbol 图层（不是 DOM Marker），保证平移/缩放一致。
- 右键新增/编辑地点、地图选点、测距、指北针、比例尺、状态栏经纬度。
- 专题图层显隐、透明度、点选信息浮层。
- 显示本次会话的路线几何（`displayRoutes`）。
- 与工作台共享编号顺序，点击标注联动右侧日程。

坐标约定：数据库/接口 WGS84；高德 GCJ-02 底图在绘制前逐点投影；路线几何也必须投影后绘制，否则整体偏移。

### 5.4 样式与主题

- `theme/antd.ts` 定义共享 token 和明暗算法。
- `styles.css` 有大量 `.ant-*` 选择器，直接覆盖 Tooltip、Modal、Notification 等 DOM。升级 Ant Design 大版本时这是最高风险的区域，必须做视觉回归。
- `store/theme.ts` 管理 `light/dark/system`，通过 `html[data-theme]` 驱动 CSS 变量。

## 6. 核心业务流

### 6.1 注册 / 登录 / 会话

```text
滑块挑战 → 发送邮箱验证码 → 注册
  → 服务端创建用户（第一个用户为 admin）
  → 登录：校验口令 → 创建 SessionToken（只存哈希）→ Set-Cookie HttpOnly
  → 响应返回 csrf_token（由会话令牌 + 密钥派生，前端只放内存）
  → 后续写请求带 X-CSRF-Token
```

- 口令使用 `hashlib.scrypt`；会话 Cookie `SameSite=Lax`，生产可加 `Secure`。
- 未配置 SMTP 时验证码只写后端日志，接口返回 `dev=true`，便于本地联调。
- 找回密码接口尚未实现；邮箱验证、改密、会话撤销已实现。

### 6.2 行程编辑

```text
工作台读取 GET /trips/{id}（含 ETag）
  → 用户修改（地点/事项/日期/顺序/交通）
  → 写请求带 If-Match
  → 后端锁行、校验 revision、写内容、写快照、revision+1
  → 前端用新 revision 更新本地状态
```

- 候选池是 `day_id=null` 的 stop。
- 跨天移动用 `reorder-stops`，一次提交所有受影响容器的完整顺序。
- 日期缩短时越界事项回候选池；固定预约清除规则由后端处理并给出警告。

### 6.3 时间线

`compute_timeline()` 对每天：

1. 从 `start_local_time` 开始。
2. 每站先加交通耗时（手工优先于供应商，同源取最近）。
3. 有固定预约：早到等待，晚到记 `LATE_FIXED_START`。
4. 有开放窗口：选第一个可用窗口；错过记 `WINDOW_MISSED`。
5. 加停留时长。
6. 最后加返回当天终点的交通；超出结束时间记 `DAY_OVERFLOW`。

缺少交通耗时时，到达时间标为不确定（`MISSING_TRAVEL`），不拿直线距离或固定速度伪造精确到达时间。

### 6.4 路线查询与保存

- 用户在日程里选两点和方式（步行/自行车/电动车/驾车/公交地铁）。
- 后端调用高德/天地图适配器，返回临时候选。
- 前端把候选几何放入 `displayRoutes` 供本次会话查看。
- 保存时只保存允许持久化的字段；当前策略下供应商几何为 `unknown`，因此刷新后需要重新查询。
- 也可手工录入交通耗时，手工数据优先参与时间线。

### 6.5 优化

- 创建 `optimization` job，带 `input_revision`、`day_id`、`mode`、`provider`。
- 矩阵来源：
  - `estimate`：直线距离 × 绕行系数 / 速度，结果标注为估算。
  - `amap`：高德 `/v3/distance` 静态矩阵，标注未验证未来路况。
- `optimize_day()` 用 2-opt / Or-opt 降低交通耗时，惩罚固定预约/时间窗冲突，尊重锁定项。
- 只支持单日；`scope=trip` 明确拒绝。
- 先预览，用户确认后才调用 `apply-optimization`；应用时再次校验 revision/hash。

### 6.6 导出与分享

```text
当前/指定 revision
  → guide.load_snapshot()
  → build_guide()（时间线 + 费用 + 来源 + warnings）
  → Markdown / DOCX
  → ExportRecord + 7 天过期
  → 下载时重新校验归属/任务/过期/行程状态
```

分享同样钉住 revision：

- 创建时返回一次完整 URL/token，数据库只存哈希。
- 可选密码、有效期 1/7/30 天、允许复制。
- 访问时校验撤销/过期/行程软删；密码解锁写短期 HttpOnly Cookie。
- 当前分享页展示 `GuideSnapshot`（攻略内容），不展示工作台地图和专题图层。

### 6.7 专题图层

- `MapLayer` 分 `mine`（用户自建）和 `system`（地铁站/公交站/酒店/景点/商场/饭店/公厕）。
- `MapLayerFeature` 坐标固定 WGS84。
- 支持打点、删除、显隐、透明度、按名称去重采集周边 POI、导出 GeoJSON。
- 系统图层不允许删除；图层属于行程，随 `TripDetail` 返回。
- 尚未进入 revision 快照，因此分享/历史/导出不包含图层。

### 6.8 地图 Key 管理

- 管理员在设置页填写高德 Web 服务 Key、天地图服务器 Key、天地图浏览器瓦片 Key。
- 值写入 `app_settings`，用 `SESSION_SECRET` 派生的 Fernet 密钥加密；接口只返回掩码。
- 保存后清空适配器缓存，立即生效，无需重启。
- 天地图浏览器 Key 必然出现在前端瓦片 URL 中，只能靠控制台域名白名单限制；服务端 Key 不下发。
- 未配置 Key 时能力返回 `configured=false` / `PROVIDER_NOT_CONFIGURED`，页面展示“未配置”，不伪造结果。

## 7. 坐标、时间与数据权利

### 7.1 坐标

- 业务几何、GeoJSON、快照、导出统一 WGS84，数据库 `SRID=4326`。
- 高德数据是 GCJ-02，不能标成 EPSG:4326；转换只发生在坐标服务/适配器边界。
- 禁止通过 `ST_SetSRID` 把一种坐标系“改成”另一种；禁止重复偏移。
- 经纬度顺序统一 `[longitude, latitude]`。

### 7.2 时间

- 行程保存 IANA 时区（默认 `Asia/Shanghai`）。
- `date` 为 `YYYY-MM-DD`，`local_time` 为 `HH:mm`，时刻为带时区 ISO8601。
- 跨午夜窗口拆到对应日期；固定预约保存带 offset 的时刻。
- 时间线计算统一转 UTC 比较，输出时再按行程时区解释。

### 7.3 数据权利

- 供应商原始响应不落库、不进日志、不进快照。
- POI 搜索结果默认只作为临时展示；用户“复制为自有地点”时只保存允许的最小字段。
- 供应商路线几何当前只用于会话展示，不进入历史/导出/分享。
- 分享和历史使用同一份经过策略筛选的快照；权限变化时重新检查，不借旧快照输出受限字段。

## 8. 已实现与未实现

### 8.1 已实现

- 账号：注册、邮箱验证码、登录、退出、改密、会话列表/撤销、头像色、管理员角色。
- 行程：多日、每日起止时间/起终点、候选池、排序、跨天移动、日期调整、复制、软删除。
- 地点：自建、搜索复制、CSV/GeoJSON 点导入、导航入口坐标、右键地图新增。
- 地图：高德矢量/影像（免 Key）、天地图（浏览器 Key）、空白底板、标注、测距、指北针、注记开关、状态栏。
- 时间线：顺推、等待、固定预约、开放窗口、日终溢出、缺少交通等冲突。
- 路线：高德驾车/步行/自行车/电动车/公交地铁适配器；手工交通；无 Key 明确报错；几何仅会话展示。
- 优化：单日启发式、估算/高德矩阵、固定预约/时间窗/锁定、预览后应用。
- 历史：revision 快照、只读查看、恢复为新版本、If-Match 并发控制。
- 攻略：Markdown / DOCX、后台任务、下载鉴权、7 天过期。
- 分享：钉住版本、有效期、密码、允许复制、撤销、只读页。
- 专题图层：点图层、系统预设、采集、显隐/透明度、GeoJSON 导出。
- 设置：地图 Key 加密保存/掩码/测试、深浅主题、账号与会话管理、出口 IP 提示。

### 8.2 未实现或仅有轻量版

| 能力 | 当前状态 |
| --- | --- |
| 找回密码 | 未实现 |
| Redis/RQ + 独立 Worker | 未实现；线程池 + jobs 表替代 |
| Alembic 迁移 | 未实现；`scripts/init_db.py` 建表 |
| Docker Compose / Nginx | 未实现；`infra/` 为空 |
| GeoJSON/GPX/KML/Shapefile/GeoPackage 完整导入 | 仅 CSV/GeoJSON 点导入 + 轻量专题图层 |
| GeoTIFF/DEM、MVT、地形、TiTiler | 未实现 |
| 外部 XYZ/WMTS/WMS/MVT 图层服务 | 未实现 |
| PWA / Service Worker / 离线攻略 | 未实现 |
| 多日优化 | 未实现；`scope=trip` 明确拒绝 |
| OR-Tools | 未使用；当前为启发式 |
| 附件/图片 | 未实现 |
| 真机 iOS/Android 验证 | 仅桌面模拟视口 |
| 邮箱 SMTP 生产验证 | 代码支持，未做生产联调 |
| 天地图底图/搜索实测 | 受域名白名单/Key 类型限制，见 PROVIDER_RESEARCH |

## 9. 当前版本快照

实测环境（2026-11-12）：

| 组件 | 当前版本 |
| --- | --- |
| Node.js | 22.18.0 |
| pnpm | 11.1.0 |
| Python | 3.13.14（`apps/api/.venv`） |
| React / React DOM | 18.3.1 |
| TypeScript | 5.9.3 |
| Vite | 6.4.5 |
| MapLibre GL JS | 5.24.0 |
| Ant Design | 5.29.3 |
| Zustand | 5.0.16 |
| React Router | 6.30.6 |
| TanStack Query | 5.105.3 |
| FastAPI | 0.115.6 |
| SQLAlchemy | 2.0.36 |
| Pydantic | 2.14.2 |
| PostgreSQL / PostGIS | 17 / 3（交付记录） |

最新稳定版、破坏性变更和推荐升级顺序见 [UPGRADE_ASSESSMENT.md](UPGRADE_ASSESSMENT.md)。

## 10. 常见改动入口

| 想改什么 | 先看哪里 |
| --- | --- |
| 新增一个 API | `apps/api/app/routers/*.py` + `schemas.py` + `main.py` 注册；再跑 `scripts/gen_openapi.py` 和 `openapi-typescript` |
| 改行程内容/版本逻辑 | `services/trip_content.py`（commit/build_snapshot/restore） |
| 改时间线规则 | `services/timeline.py` + `tests/test_schedule.py` |
| 改优化 | `services/optimize.py` + `services/runners.py` + `tests` |
| 改导出/分享 | `services/guide.py`、`routers/exports.py`、`routers/shares.py` |
| 改地图交互/底图 | `components/MapCanvas.tsx`、`theme/antd.ts`、`styles.css` |
| 改工作台布局/日程 | `pages/WorkspacePage.tsx`、`components/SidePanel.tsx`、`components/DayPanel.tsx` |
| 改登录/会话 | `routers/auth.py`、`deps.py`、`security.py`、`store/app.ts` |
| 改供应商能力 | `providers/*.py` + `config/provider_policy.json` |
| 改前端主题 | `theme/antd.ts` + `store/theme.ts` + `styles.css` |

## 11. 已知技术债与风险

1. **没有 Python 依赖清单/锁文件**：无法从仓库可重复重建 venv，升级前必须先冻结。
2. **没有数据库迁移**：`create_all` 只适合开发；上线前需要 Alembic 基线。
3. **任务队列是进程内线程池**：多副本、重启恢复和长任务隔离不足；换 RQ 是明确后续项。
4. **限流是进程内**：多副本部署会失效，需要 Redis 等共享存储。
5. **快照未包含图层**：分享/历史/导出看不到专题图层，和 API 契约中的 `TripDetail.map_layers` 有差异。
6. **`styles.css` 深度覆盖 Ant Design DOM**：AntD 大版本升级必须做视觉回归。
7. **地图组件体量大**：`MapCanvas.tsx` 职责多，后续可拆为底图、标注、测量、图层、路线子模块。
8. **供应商持久化策略保守**：路线几何默认不落库，刷新后重查；这是合规选择，不是 bug。
9. **前端版本组合偏旧**：React 18 / Vite 6 / AntD 5 / MapLibre 5 / TS 5.9，升级路径见评估文档。
10. **缺少容器化**：本机依赖直装 PostgreSQL/Node/Python，换机成本高；用户已表示可安装 Docker，建议补 Compose。

## 12. 术语

| 术语 | 含义 |
| --- | --- |
| revision | 行程内容版本号；每次内容写事务 +1 |
| 快照 | `trip_revisions.snapshot` 中的完整业务投影 |
| 候选池 | `day_id=null` 的事项，尚未安排到某天 |
| 停/事项 | `Stop`，一天中的一个活动节点 |
| 地点 | `Place`，行程内的地点库条目，可被多个事项引用 |
| 交通段 | `RouteLeg`，两点之间的交通结果或手工录入 |
| 专题图层 | `MapLayer` + `MapLayerFeature`，一叠可开关的点 |
| 策略 | `provider_policy.json` 中按能力的 allowed/denied/unknown |
| 估算矩阵 | 直线距离 × 绕行系数 / 速度，明确标注不是真实路网 |
