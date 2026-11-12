# 旅游规划平台 · 行迹

本仓库是 `docs/IMPLEMENTATION_PLAN.md` 的**可运行实现**（P0–P1 纵向闭环 + P2/P3/P4 的部分能力），不是页面骨架。当前状态与方案文档的差异、未实现项、外部依赖，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 8–10 节。

想快速理解代码结构，先看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。当前实际版本为 React 19.3.1 / Vite 8.3.8 / TypeScript 7.0.2 / MapLibre 5.24 / Ant Design 6.7；2026-11-12 已完成工具链（Vite 8、plugin-react 6、TypeScript 7）与 UI 栈（React 19、Router 7、AntD 6）升级，MapLibre 6 / 后端依赖尚未升级。版本快照、AntD 6 DOM 适配和升级验证见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节。

## 现在能做什么

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 账号 | 可用 | 注册/登录/退出/会话列表/改密；服务端不透明会话 + HttpOnly Cookie + 派生 CSRF；scrypt 散列 |
| 行程 | 可用 | 多日行程、每日起止时间、当天起终点、跨天移动、上移/下移、候选池、日期调整（越界回候选池） |
| 地点 | 可用 | 自建地点、搜索结果复制为自有地点、CSV/GeoJSON 点导入、导航入口坐标 |
| 地图 | 可用 | MapLibre；高德矢量/影像（免 Key）、天地图矢量/影像（浏览器端 Key）、空白底板；标注走 GeoJSON 图层与地图同步；缩放/复位/测距/指北针（带俯仰与旋转角度）、底图浮层与注记开关；右键就地新增地点；状态栏显示比例尺轴线、经纬度、层级与 EPSG |
| 时间线 | 可用 | 交通 → 等待开放 → 停留顺推；固定预约迟到、开放窗口错过、超出结束时间、缺交通耗时四类冲突 |
| 路线 | 受外部依赖 | 高德驾车/步行/自行车/电动车/公交地铁适配器已写（公交几何按分段拼接，换乘策略可选）（骑行两接口 2026-11-10 实测，见 `docs/PROVIDER_RESEARCH.md#7`）；未配置 Key 时明确返回 `PROVIDER_NOT_CONFIGURED`；可手工录入交通。路网几何只在本次会话显示，不入库 |
| 优化 | 可用（启发式） | 单日 2-opt / Or-opt，支持固定预约、时间窗、锁定顺序；先预览后应用；估算矩阵会标注 |
| 历史 | 可用 | 每次内容写入产生 revision 快照；只读查看；恢复为新版本；If-Match 并发控制 |
| 攻略 | 可用 | 同一快照生成 Markdown 与 DOCX；后台任务状态机；下载鉴权与 7 天过期 |
| 分享 | 可用 | 钉住版本、有效期、可选密码、允许复制、撤销；只读页面 |
| 数据源策略 | 可用 | 每个能力按用途 allowed/denied/unknown；默认不持久化供应商记录，只保存用户复制的最小字段 |
| 设置 | 可用 | 左导航单屏布局（数据源/外观/账号/会话/关于）；高德与天地图 Key 加密入库、只回掩码、保存即生效、可单个测试；深浅主题；行程连线的颜色（SV 取色器 + 10 档色阶）/线型/粗细（0.5px 一档）；账号与会话管理 |

## 目录

```text
travel-planner/
  apps/api/            FastAPI 后端（app/ 领域模块，tests 见根目录 tests/）
  apps/web/            React + Vite 前端（src/api/schema.d.ts 由 OpenAPI 生成）
  config/              供应商用途策略
  scripts/             建库、OpenAPI 导出、示例数据
  docs/                方案、契约、验收、架构、供应商核实记录
  tests/               pytest（纯逻辑 + PostgreSQL 集成）
```

## 快速开始

前置：Node 22.12+（当前 22.18.0）、pnpm 11、Python 3.13、PostgreSQL 17 + PostGIS 3。当前开发方式不依赖 Docker；Docker Compose 尚未落地，容器化计划见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 2.2 节。

1. 写后端配置 `apps/api/.env`（已生成，只需改一行密码）：

```ini
DATABASE_URL=postgresql+psycopg://postgres:你的postgres密码@127.0.0.1:5432/travel_planner
SESSION_SECRET=已自动生成
PUBLIC_BASE_URL=http://localhost:5177
```

密码只从该文件读取，不需要在终端交互输入。若密码含 `@`、`:`、`/` 等字符，需按 URL 编码（例如 `@` 写成 `%40`）。

2. 建库、启用 PostGIS、建表（用 postgres 账号，需要 CREATEDB 权限）：

```bat
apps\api\.venv\Scripts\python.exe scripts\init_db.py
apps\api\.venv\Scripts\python.exe scripts\seed_demo.py   rem 可选：南昌三日示例
```

Python 依赖基线已冻结在 `apps/api/requirements.lock.txt`（含全部传递依赖，2026-11-12 由 `pip freeze` 生成）。换机或重建 venv 时可用：

```bat
apps\api\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.lock.txt
```

3. 启动后端与前端：

双击根目录的 `dev.cmd`，会开两个窗口分别跑后端与前端，关窗口即停服。也可以只起一端：

```bat
dev-api.cmd   rem 只起后端
dev-web.cmd   rem 只起前端
```

三个文件都是普通 `.cmd`，用记事本就能看清里面跑的是什么。手工敲命令时注意用反斜杠——cmd 里把 `/` 当作参数开关，`apps/api/...` 会被拆成 `apps` 加参数：

```bat
apps\api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir apps\api --reload --port 8007
cd apps\web
pnpm dev
```

`apps/web/pnpm-workspace.yaml` 现在只声明 workspace 根目录，不再覆盖 `@types/react`。React 18 阶段曾把 `@types/react` 固定为 18.3.12，避免 `@types/react-dom@18` 解析到 React 19 类型；升级 React 19 后该 override 已删除，类型检查与构建均通过。

打开 http://localhost:5177 。示例账号 `demo@example.com` / `demo-password-123`（管理员），或自行注册（第一个注册者为管理员）。注册需邮箱验证码：没配 SMTP 时验证码打印在后端日志里。接口文档在 http://127.0.0.1:8007/docs 。

地图 Key 不必改 `.env`：登录后在「设置 → 地图数据源」填写，保存立即生效。Key 加密存库、接口只返回掩码；天地图浏览器瓦片 Key 会出现在前端瓦片地址里，只能靠控制台域名白名单限制。

底图里高德矢量/影像无需任何 Key，首次打开即可见；天地图必须配浏览器端 Key 才能出图。

三类 Key 用途互不通用，别填错字段：

| 字段 | 天地图/高德控制台应选类型 | 用在哪 | 额外要求 |
| --- | --- | --- | --- |
| 天地图浏览器瓦片 Key | 天地图「浏览器端」 | 前端直接请求底图瓦片 | 域名白名单加 `localhost`、`127.0.0.1` 或实际域名 |
| 天地图服务端 Key | 天地图「服务器端」 | 后端 POI 搜索、地理编码 | IP 白名单加服务器出口 IP，设置页会显示当前值 |
| 高德 Web 服务 Key | 高德「Web 服务」 | 后端搜索、路径、天气 | 无需白名单 |

「安卓端」Key 绑定包名与签名，网页平台用不上。同一个浏览器端 Key 填进「服务端」字段，搜索会被天地图以 `301012 权限类型错误` 拒绝。

瓦片返回 403 时响应体是 `301007 域名不匹配`，页面上会弹一次可照做的提示；把当前访问地址加入白名单即可，不用重启服务。底图走 `https://t{0-7}.tianditu.gov.cn/DataServer?T=vec_w&x=&y=&l=&tk=`（XYZ 风格，`l` 即缩放级别），不用 WMTS 的 `TILEMATRIX`——后者矩阵编号与 MapLibre 级别差一级，且 `{s}` 子域占位符 MapLibre 不解析。

## 验证

```bat
# 纯逻辑：坐标往返、排程、攻略快照（无需数据库）
apps\api\.venv\Scripts\python.exe -m pytest tests/test_coords.py tests/test_schedule.py tests/test_guide.py -q

# 全部：含版本/权限/优化/导出/分享的集成测试（需要测试库，首次由 init_db 同账号创建）
set TEST_DATABASE_URL=postgresql+psycopg://postgres:密码@127.0.0.1:5432/travel_planner_test
apps\api\.venv\Scripts\python.exe -m pytest tests -q

# 前端类型与构建
cd apps/web && pnpm typecheck && pnpm build

# 依赖 peer 一致性（升级依赖后执行）
cd apps/web && pnpm peers check

# 接口类型重新生成（后端模型变更后执行）
apps\api\.venv\Scripts\python.exe scripts/gen_openapi.py
cd apps/web && pnpm codegen:api
```

> `pnpm codegen:api` 通过 `pnpm dlx` 临时使用 TypeScript 5.9.3 + openapi-typescript 7.13.0。openapi-typescript 目前仍调用 TS 5 的 `ts.factory`，在项目使用的 TypeScript 7 下会崩溃；隔离运行可以同时保留 TS 7 类型检查和 OpenAPI 类型生成。

## 外部依赖与未完成项

- **地图 Key**：已改为在设置页维护（加密入库、掩码回显）。底图能否出图取决于天地图控制台的域名白名单，本机未加 `localhost` 时返回 `403 / 301007`，页面会提示具体原因并给出处理步骤。服务端能力仍标记 `verified=false`，未逐项实测前不宣称可用；核对清单见 `docs/PROVIDER_RESEARCH.md`。
- **邮件**：注册与登录都走邮箱验证码（滑块 → 发码 → 校验），验证码只存哈希。未配 SMTP 时只写服务端日志、接口返回 `dev=true`，本地可直接从后端日志取码。生产环境需在 `.env` 配 `SMTP_HOST/PORT/USER/PASSWORD/FROM`。找回密码接口尚未实现。
- **任务队列**：本机无 Redis，用进程内线程池 + 数据库状态机替代 RQ；接口语义一致，换 RQ 只需替换 `services/jobs.py` 的 `submit`。
- **GIS 栅格与三维**：GeoTIFF/DEM、MVT、地形、外部图层服务未实现；当前仅支持 CSV/GeoJSON 点导入。
- **PWA 离线**：应用可构建为静态站点，但 Service Worker/离线攻略未实现。
- **多日优化**：仅单日重排；全程分配未实现，接口对 `scope=trip` 返回明确错误。

## 文档

1. [文档索引](docs/README.md) — 每份文档的用途、阅读顺序与维护约定
2. [架构说明](docs/ARCHITECTURE.md) — 当前实现、交付差异、验证记录、版本与升级状态
3. [完整实现方案](docs/IMPLEMENTATION_PLAN.md) — 产品范围、P0–P5 阶段计划与目标架构
4. [API 与类型契约](docs/API_CONTRACT.md) — 接口、错误码、权限与公共类型
5. [验收与测试清单](docs/ACCEPTANCE.md) — 分阶段验收标准与出口条件
6. [地图供应商核实记录](docs/PROVIDER_RESEARCH.md) — 外部能力事实、来源与验证状态
7. [AI 开发约定](AGENTS.md)
