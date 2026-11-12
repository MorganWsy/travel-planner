# 行迹（travel-planner）架构说明

基线日期：2026-11-12。本文描述**当前仓库实际实现**，不是未来方案。产品目标与阶段计划见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)，接口契约见 [API_CONTRACT.md](API_CONTRACT.md)，验收基线见 [ACCEPTANCE.md](ACCEPTANCE.md)，供应商核实见 [PROVIDER_RESEARCH.md](PROVIDER_RESEARCH.md)。原 `DELIVERY.md` 的交付差异、验证记录和原 `UPGRADE_ASSESSMENT.md` 的版本升级记录已合并到本文第 9、10 节。

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

### 2.2 目标部署（尚未落地）

`IMPLEMENTATION_PLAN.md` 规划的是同域 Nginx + API + Worker + PostgreSQL/PostGIS + Redis/RQ + 私有文件存储。当前 `infra/` 为空，没有 Compose、Nginx、Redis/RQ 或 Alembic 迁移。

容器化建议顺序：先容器化 PostgreSQL/PostGIS 测试库，拿到可重复的集成测试环境；再补 API/Web 服务；Redis/RQ 等任务队列真正替换时再加。保留现有 `dev.cmd` 的本机开发方式，不强制所有人用容器。

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

> 当前快照包含 days / places / stops / route_legs，不包含 map_layers。专题图层只在所有者工作台的 `TripDetail` 中返回；分享页使用 `GuideSnapshot`，因此当前分享不展示图层。这是已知差异，见 8.2 与 12.4。

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

AntD 6 的实际 DOM 变化（2026-11-12 已按运行时复核）：

| 组件 | AntD 5 选择器 | AntD 6 选择器 |
| --- | --- | --- |
| Modal 内边距容器 | `.ant-modal-content` | `.ant-modal-container` |
| Tooltip 内容 | `.ant-tooltip-inner` | `.ant-tooltip-container` |
| Tooltip 箭头 | `.ant-tooltip-arrow::before/::after` | `.ant-tooltip-arrow-content` |
| Notification 标题 | `.ant-notification-notice-message` | `.ant-notification-notice-title` |
| Message 外框 | `.ant-message-notice-content` | `.ant-message-notice` |
| Select 内容 | `.ant-select-selector` | `.ant-select-content` |

Table 字号不再靠 `.ant-table { font-size }` 覆盖，而是使用组件 token `cellFontSize` / `cellFontSizeMD` / `cellFontSizeSM`；否则会被 `.ant-table-small` 的变量重新定义绕开。

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

## 9. 当前版本与升级状态

实测环境（2026-11-12）：

| 组件 | 当前版本 |
| --- | --- |
| Node.js | 22.18.0 |
| pnpm | 11.1.0 |
| Python | 3.13.14（`apps/api/.venv`） |
| React / React DOM | 19.3.1 |
| TypeScript | 7.0.2 |
| Vite | 8.3.8 |
| `@vitejs/plugin-react` | 6.3.0 |
| MapLibre GL JS | 5.24.0 |
| Ant Design | 6.7.0 |
| `@ant-design/icons` | 6.3.4 |
| Zustand | 5.1.0 |
| React Router | 7.18.5 |
| TanStack Query | 5.107.1 |
| dayjs | 1.11.23 |
| FastAPI | 0.115.6 |
| SQLAlchemy | 2.0.36 |
| Pydantic | 2.14.2 |
| GeoAlchemy2 | 0.16.0 |
| psycopg | 3.2.3 |
| uvicorn | 0.34.0 |
| pytest | 8.3.4 |
| python-docx | 1.1.2 |
| PostgreSQL / PostGIS | 17 / 3（交付记录） |

锁文件：`apps/web/pnpm-lock.yaml`、`apps/api/requirements.lock.txt`（2026-11-12 `pip freeze`）。

### 9.1 已完成升级

**第 0 步：冻结基线（2026-11-12）**

- 用 `pip freeze` 冻结 Python 环境到 `apps/api/requirements.lock.txt`。
- 基线复跑：纯逻辑 pytest 16 passed；全量 16 passed / 16 skipped（未设置 `TEST_DATABASE_URL`）；`pip check` 无冲突；前端 typecheck / build 通过。

**第 1 步：工具链（2026-11-12，提交 `8dbab0f`）**

- 升级 `vite@8.3.8`、`@vitejs/plugin-react@6.3.0`、`typescript@7.0.2`。
- `vite.config.ts` 从对象形式 `manualChunks` 改为 `build.rolldownOptions.output.codeSplitting.groups`，保留 react / maplibre / antd 三个 vendor 分块。
- `tsconfig.json` 删除未使用的 `baseUrl` / `paths`；`src/vite-env.d.ts` 显式引用 `@types/geojson`，因为 TS 7 不再自动带入全局命名空间。
- `openapi-typescript@7.13.0` 仍调用 TS 5 的 `ts.factory`，已从应用依赖移除，改为 `pnpm codegen:api` 在隔离环境中使用 TypeScript 5.9.3。

**第 2 步：UI 栈（2026-11-12）**

- 升级 React 19.3.1 / React DOM 19.3.1 / `@types/react` 19.3.0 / `@types/react-dom` 19.3.0。
- 升级 `react-router-dom@7.18.5`，删除 `BrowserRouter` 的 `future` 参数。
- 升级 `antd@6.7.0`、`@ant-design/icons@6.3.4`。
- 升级 `zustand@5.1.0`、`@tanstack/react-query@5.107.1`、`dayjs@1.11.23`。
- 删除 `apps/web/pnpm-workspace.yaml` 中 `@types/react: 18.3.12` 的 override。
- 按 AntD 6 运行时 DOM 修正 `styles.css`：Modal、Tooltip、Notification、Message、Select；Table 字号改走主题 token。
- 把 `notify.tsx` 的 notification 标题字段从 `message` 改为 `title`。

### 9.2 升级验证（UI 批次）

| 检查 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| peer 依赖 | `pnpm peers check` | 无问题 |
| 类型检查 | `pnpm typecheck`（TS 7.0.2） | 0 错 |
| 生产构建 | `pnpm build`（Vite 8.3.8 / Rolldown） | 通过，约 0.8s |
| 产物体积 | `dist/assets` | react 257.76KB、antd 993.81KB、maplibre 1,027.67KB、WorkspacePage 94.60KB、index 88.11KB |
| 桌面冒烟 | 演示账号登录 → 行程列表 → 工作台 → 地图 → 时间线 → 攻略 → 导出 MD | 正常，控制台无 error/warning |
| 历史页 | 版本列表、快照详情、表格 | 正常，表格字号 13px |
| 设置页 | 地图数据源、外观、登录会话表格、Popconfirm | 正常 |
| 分享弹窗 | 有效期 Select、密码 Input、原生 checkbox | 正常，Modal 内边距 10px 12px |
| 新建行程 | RangePicker、日期面板 | 正常 |
| 深色主题 | message / notification / tooltip / 页面变量 | 背景 `#19212b`、文字 `#e5edf6`，箭头颜色一致 |
| AntD 6 组件 | Modal、Tooltip、Notification、Message、Select、DatePicker、TimePicker、Popconfirm、Segmented、Table、Dropdown | 已逐项检查 DOM 与关键样式 |

未在本批次复测：390×844 手机视口、真机浏览器、注册/验证码全流程、地图三种底图切换与测距。这些仍需在完整验收时执行。当前 headless 预览环境不触发 `requestAnimationFrame`，rc-motion 的进出场动画会停在 prepare 状态，不能把动画状态当作应用缺陷；真实浏览器需另行确认。

### 9.3 尚未升级

| 项 | 当前 | 目标/说明 |
| --- | --- | --- |
| MapLibre GL JS | 5.24.0 | 6.x：ESM-only、要求 WebGL2；默认导入需改命名空间导入，并补 WebGL2 降级提示 |
| FastAPI / Starlette | 0.115.6 / 0.41.3 | 0.16x；回归路由、异常、CORS、静态托管、OpenAPI |
| SQLAlchemy / GeoAlchemy2 | 2.0.36 / 0.16.0 | 2.1 / 0.21 一起升级，跑 PostGIS 集成测试 |
| pytest | 8.3.4 | 9.x；回归 fixture 作用域与配置项 |
| cryptography | 44.0.0 | 50.x；回归 Fernet 加解密、Key 掩码 |
| Node / pnpm | 22.18.0 / 11.1.0 | Node 24 LTS、pnpm 12 可选；升级 pnpm 会改锁文件格式 |
| Docker | 未安装 | 先补 PostgreSQL/PostGIS Compose，再补 API/Web |

升级原则：按层提交、每层可回滚；不要把 React、MapLibre、后端依赖塞进同一个无法定位问题的提交。

## 10. 交付范围、差异与验证

### 10.1 交付范围

已实现一条可运行的纵向闭环：注册登录 → 建行程 → 建/导地点 → 排事项 → 看时间线与冲突 → 手工或真实路线 → 单日优化预览并应用 → 版本历史与恢复 → 攻略导出（MD/DOCX）→ 分享只读页。

未实现：找回密码、Redis/RQ、Alembic 迁移、Docker Compose/Nginx、GIS 栅格与矢量瓦片、地形与三维、外部图层服务、PWA 离线、多日优化、OR-Tools、附件与图片、原生 App 与 Electron。邮箱验证码与可选 SMTP 已实现（未配 SMTP 时验证码写日志）；分享页当前只展示攻略快照，不包含地图图层。

判定标准遵循 `AGENTS.md`：不把“页面能打开”“接口返回 200”当作完成；每个能力在 `/api/v1/providers/capabilities` 中标注 configured/verified，未实测项不宣称可用。

### 10.2 关键设计决策

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 口令用 `hashlib.scrypt`（N=2^14, r=8, p=1） | 本机无 Argon2 依赖；scrypt 同为内存硬散列且在 stdlib | 与 Argon2id 的行业推荐不同，后续可在 `security.py` 单点替换 |
| CSRF 由会话令牌 HMAC 派生 | 刷新后服务端可重算同一值，无需存明文，也不把令牌放 localStorage | 令牌泄露即 CSRF 失效，与 Cookie 同源风险一致 |
| 任务用线程池 + 数据库状态机 | 本机无 Redis；契约要求的状态、幂等、取消、重试语义必须保留 | 单进程有效；多副本需换 RQ/Celery，`services/jobs.py::submit` 是唯一替换点 |
| 无路网数据时用“直线 × 绕行系数”估算矩阵 | 让优化在无 Key 时仍可演示与测试，结果强制标注 `matrix_source=estimate` | 估算值不能承诺真实行程时间，UI 与导出均带警示 |
| 供应商记录默认不落库，只保存用户复制的最小字段 | 没有书面授权证据，`persist=unknown` 不能当作 allowed | 保存后不再关联 provider_id，无法回查详情 |
| 分享快照只存业务投影 | 历史、导出、分享、离线必须来自同一份允许保存的数据 | 含几何副本，体积随版本增长 |
| 优化仅支持单日 | 多日分配需要真实矩阵、节点上限和更复杂约束 | `scope=trip` 明确拒绝，不静默降级 |

### 10.3 与方案文档的差异

| 条目 | 方案 | 实现 | 原因 |
| --- | --- | --- | --- |
| 任务队列 | Redis + RQ | 线程池 + jobs 表 | 本机无 Redis；语义保留 |
| 邮件 | 验证邮件 + 找回密码 | 邮箱验证码 + 可选 SMTP；找回密码未实现 | 未配 SMTP 时写日志；不伪造生产邮件 |
| 供应商持久化 | 按用途矩阵 | 默认 persist=unknown，仅存用户复制字段 | 无授权证据 |
| 优化器 | OR-Tools | 2-opt / Or-opt 启发式 | OR-Tools 未安装且 Python 3.13 轮子不确定；方案只承诺可行/限时改进 |
| PWA | vite-plugin-pwa + Workbox | 未实现 | 优先级低于核心闭环 |
| 数据库迁移 | Alembic | `scripts/init_db.py` 建表 | 开发期够用；上线前补 Alembic 基线 |
| 前端 React | React 19 | React 19.3.1 | 2026-11-12 已对齐 |

### 10.4 安全与数据权利边界

- Key 通过设置页写入 `app_settings`，使用 `SESSION_SECRET` 派生的 Fernet 密钥加密；接口只返回掩码（前 4 + 后 4），明文不下发。保存后重建适配器缓存，立即生效。
- 只有 `role=admin` 可写 Key；第一个注册者自动成为管理员。
- 天地图浏览器瓦片 Key 必然出现在前端瓦片 URL 中，只能靠控制台域名白名单限制；服务端 Key 不下发。
- 会话令牌 32 字节随机，库中只存 SHA-256；Cookie HttpOnly、SameSite=Lax，生产可加 Secure；空闲 7 天、最长 14 天。
- 登录限流 10 次/15 分钟（IP+邮箱），注册 5 次/小时，分享密码 5 次/15 分钟；限流为进程内，多副本需改 Redis。
- 越权统一返回 404，不区分“不存在”和“无权访问”；下载与分享访问都重新校验归属与有效期。
- 日志不记录请求体与 Key；错误响应不含堆栈与上游原始报文。
- 分享页明确告知：已下载到设备的副本无法被服务端撤回。

### 10.5 验证记录

**2026-11-12 基线与工具链**

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端纯逻辑测试 | `pytest tests/test_coords.py tests/test_schedule.py tests/test_guide.py -q` | 16 passed |
| 后端全量测试 | `pytest tests -q` | 16 passed / 16 skipped（未设置 `TEST_DATABASE_URL`） |
| Python 依赖一致性 | `pip check` | No broken requirements found |
| 前端 peer 依赖 | `pnpm peers check` | 无问题 |
| 前端类型检查 | `pnpm typecheck` | 0 错 |
| 前端构建 | `pnpm build` | 通过；react 257.76KB、antd 993.81KB、maplibre 1,027.67KB |
| 开发服务器 | `pnpm dev --host 127.0.0.1` | Vite 8.3.8 启动，登录页正常 |
| 生产构建托管 | FastAPI 托管 `dist`，访问 `:8007` | 登录页与静态资源正常，无 pageerror |
| 登录后主流程 | 演示账号登录 → 行程列表 → 工作台 → 地图 → 时间线 | 正常；地图画布 400×274；无 pageerror |
| OpenAPI 类型生成 | `pnpm codegen:api`（隔离 TS 5.9.3） | 成功生成 `src/api/schema.d.ts` |

**2026-11-04 历史验证（AntD 5 基线，UI 升级后需复测的部分已注明）**

- 桌面 1440×900：登录 → 工作台 → 攻略 → 历史 → 分享，无 pageerror；行程卡片 3 天 / 12 事项；地图标记编号按日期顺序。
- 手机 390×844：横向溢出 0px；顶栏图标完整；地图后紧接当天行程，行程/地点分段切换。（AntD 6 批次未复测）
- 多尺寸 1920×1080 / 1440×900 / 1366×768 / 1280×800 / 1024×768 / 390×844：页面级横向与纵向溢出均为 0；滚动只发生在面板与设置页内容区内部。
- 深浅主题：登录页、工作台、设置页各切换一次；Tooltip 浅色 `#ffffff/#1b2129`、深色 `#19212b/#e5edf6`，无残留深色气泡。
- 拖动排序、侧栏收起、地图控件、设置页五组、高德底图、字号层级、GeoJSON 标注、指北针、测距、右键新增、注记开关、版本历史、天地图搜索、分享链路、MD/DOCX 导出均已做过回归。
- 数据库初始化：PostgreSQL 17.2 / PostGIS 3.5，13 张表建成；设置 `TEST_DATABASE_URL` 时全量测试 29 passed。
- 实测中发现并修复：`trip_stops` 排序错位、攻略交通段索引键不一致、跨容器移动校验过严、锁定顺序校验、移动端顶栏溢出。

### 10.6 待补外部验证

| 检查 | 阻塞原因 |
| --- | --- |
| 天地图底图出图 | 浏览器端 Key 的域名白名单未包含 `localhost`，瓦片返回 `403 / 301007`；代码已改用 DataServer XYZ 接口 |
| 天地图服务端搜索 | 当前字段填的是浏览器端 Key，需换「服务器端」类型并配 IP 白名单 |
| 高德各能力实测 | 已配置 Web 服务 Key，仍需逐项核对配额与允许用途 |
| DOCX 人工打开检查 | 需人工确认中文字体、分页与长备注 |
| 真机 Android Chrome / iPhone Safari | 需要真机；当前为桌面浏览器模拟视口 |

### 10.7 遗留项与推进顺序

1. **P0 剩余**：用项目 Key 逐项实测搜索/地理编码/驾车/步行/公交/天气，把 `verified` 改为 true 并记录 QPS 与允许用途。
2. **Alembic 基线迁移**：用当前模型生成 `0001_initial`，CI 检查 `alembic check`；`init_db.py` 仅用于本地。
3. **P2 补全**：输入提示去抖与旧请求取消、双源分组展示、`no-store` 全链路核查、公交城市上下文校验。
4. **P3 扩展**：真实矩阵预算控制（每任务 400 段上限）、多日分配、冲突诊断文案。
5. **P4 补全**：附件/图片、GeoPackage 与 Shapefile 预检、COG/DEM 与 TiTiler、PWA 离线攻略、分享页图层。
6. **发布前**：SMTP 生产联调、HTTPS 与反向代理、备份恢复演练、日志脱敏审计。
7. **技术栈**：MapLibre 6、后端依赖升级；详见 9.3。
8. **容器化**：先 PostgreSQL/PostGIS 测试库，再 API/Web，Redis/RQ 最后加。

### 10.8 对原方案的修正意见

1. **范围与节奏**：P0–P5 加 Electron 是数月量级；首版应收窄为“可保存的行程 + 时间线 + 导出 + 分享”，GIS 与三维后置。
2. **用途矩阵可操作性**：`persist=unknown` 在合规上正确，但会切断“搜索→保存”。建议字段级策略：名称、坐标、类别等事实性最小字段允许保存并标注来源；介绍、图片、评分等受限字段禁止。
3. **优化指标与配额**：真实矩阵获取时间远大于求解时间，应把预算写成“矩阵请求数优先，求解时间其次”，并明确矩阵复用/缓存条件。
4. **并发模型**：800ms 防抖自动保存 + 全量 revision + If-Match，多标签页会频繁 409；建议按实体粒度做版本，或把长文本单独存放。
5. **时间语义**：目标用户主要在中国大陆，首版建议固定 `Asia/Shanghai`，把时区做成只读字段。
6. **快照体积**：30 天 × 30 事项、200 个版本约 10–20MB/行程；写入时可压缩（JSONB + zstd 或 gzip 列）。
7. **外部配置耦合**：地图表现依赖天地图域名白名单/Key 类型，代码替代不了控制台配置；设置页应显示当前访问地址，方便对照填写。

## 11. 常见改动入口

| 想改什么 | 先看哪里 |
| --- | --- |
| 新增一个 API | `apps/api/app/routers/*.py` + `schemas.py` + `main.py` 注册；再跑 `scripts/gen_openapi.py` 和 `pnpm codegen:api` |
| 改行程内容/版本逻辑 | `services/trip_content.py`（commit/build_snapshot/restore） |
| 改时间线规则 | `services/timeline.py` + `tests/test_schedule.py` |
| 改优化 | `services/optimize.py` + `services/runners.py` + `tests` |
| 改导出/分享 | `services/guide.py`、`routers/exports.py`、`routers/shares.py` |
| 改地图交互/底图 | `components/MapCanvas.tsx`、`theme/antd.ts`、`styles.css` |
| 改工作台布局/日程 | `pages/WorkspacePage.tsx`、`components/SidePanel.tsx`、`components/DayPanel.tsx` |
| 改登录/会话 | `routers/auth.py`、`deps.py`、`security.py`、`store/app.ts` |
| 改供应商能力 | `providers/*.py` + `config/provider_policy.json` |
| 改前端主题 | `theme/antd.ts` + `store/theme.ts` + `styles.css` |

## 12. 已知技术债与风险

1. **数据库迁移仍是 `create_all`**：只适合开发；上线前需要 Alembic 基线。Python 依赖已冻结到 `apps/api/requirements.lock.txt`。
2. **任务队列是进程内线程池**：多副本、重启恢复和长任务隔离不足；换 RQ 是明确后续项。
3. **限流是进程内**：多副本部署会失效，需要 Redis 等共享存储。
4. **快照未包含图层**：分享/历史/导出看不到专题图层，和 API 契约中的 `TripDetail.map_layers` 有差异。
5. **`styles.css` 深度覆盖 Ant Design DOM**：AntD 6 已完成一轮适配，但后续升级仍必须做视觉回归；优先逐步迁移到 `classNames` / `styles` API。
6. **地图组件体量大**：`MapCanvas.tsx` 职责多，后续可拆为底图、标注、测量、图层、路线子模块。
7. **供应商持久化策略保守**：路线几何默认不落库，刷新后重查；这是合规选择，不是 bug。
8. **MapLibre 6 与后端依赖待升级**：UI 栈已到 React 19 / AntD 6 / Router 7；MapLibre 仍是 5.24.0，后端仍是 FastAPI 0.115 / SQLAlchemy 2.0。升级路径见 9.3。
9. **缺少容器化**：本机依赖直装 PostgreSQL/Node/Python，换机成本高；用户已表示可安装 Docker，建议补 Compose。
10. **AntD 6 批次未复测手机视口与真机**：390×844、iPad、Android Chrome、iPhone Safari 仍需在后续验收中执行；当前只完成桌面浏览器回归。
11. **`openapi-typescript` 与 TS 7 不兼容**：只能通过 `pnpm codegen:api` 的隔离 TS 5.9.3 运行，上游修复前不要把它加回应用依赖。

## 13. 术语

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
