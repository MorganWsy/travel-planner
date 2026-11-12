# 技术栈升级评估（2026-11-12）

本文记录版本核实、升级设计与执行进展。**2026-11-12 已完成第 0 步基线与第 1 步工具链升级**：Vite 8.3.8、`@vitejs/plugin-react` 6.3.0、TypeScript 7.0.2 已安装并通过类型检查与构建；React 19 / AntD 6 / Router 7 / MapLibre 6 / 后端依赖尚未升级。

## 1. 结论

可以升级，而且建议升级，但不建议“把 package.json 里的版本号一把替换再祈祷能跑”。当前项目是一套能运行的纵向闭环，升级的主要风险不在业务代码，而在三处：

1. **Ant Design 6 改变了 DOM 与 CSS 变量机制**，而 `styles.css` 有大量 `.ant-*` 直接覆盖。
2. **MapLibre 6 改为 ESM-only、要求 WebGL2**，当前是默认导入，必须改命名空间导入，并做地图回归。
3. **Vite 8 切换到 Rolldown/Oxc**，当前 `manualChunks` 对象写法需要调整；TypeScript 7 的原生编译器也会对旧 `tsconfig` 选项更严格。

推荐分四步走：**先冻结基线 → 再升级工具链 → 再升级 UI/React → 最后升级 MapLibre 与后端依赖**。每一步都能独立回滚，不要把所有大版本塞进一个无法定位问题的提交。

### 1.1 已执行（2026-11-12）

- 用 `pip freeze` 把当前 Python 环境冻结到 `apps/api/requirements.lock.txt`（50 行，含全部传递依赖）。
- 基线复跑：纯逻辑测试 16 passed；全量 `pytest tests -q` 为 16 passed / 16 skipped（未设置 `TEST_DATABASE_URL`，集成测试按设计跳过）；`pip check` 无冲突；前端 `pnpm typecheck`、`pnpm build` 均通过。
- 升级 `vite@8.3.8`、`@vitejs/plugin-react@6.3.0`、`typescript@7.0.2`，React/AntD/MapLibre/Router 保持不变。
- `vite.config.ts` 从对象形式 `manualChunks` 改为 `build.rolldownOptions.output.codeSplitting.groups`，保留 react / maplibre / antd 三个 vendor 分块。
- `tsconfig.json` 删除未使用的 `baseUrl`/`paths`；`src/vite-env.d.ts` 显式引用 `@types/geojson`，因为 TS 7 不再自动把它的全局命名空间带进项目。
- 验证结果：`pnpm peers check` 无问题；`pnpm build` 约 0.7s 完成，MapLibre 与 AntD chunk 各约 1MB；Vite 8 开发服务器和 FastAPI 托管的生产构建都能打开登录页；演示账号登录后行程列表、工作台、地图画布、时间线均正常，控制台无 pageerror。
- 发现并处理一个真实阻塞：`openapi-typescript@7.13.0` 的 peer 仍是 TypeScript `^5.x`，运行时会调用 TS 5 的 `ts.factory`，在 TS 7 下必崩。已把它从应用 `devDependencies` 移除，改为 `pnpm codegen:api`：通过 `pnpm dlx` 隔离安装 TypeScript 5.9.3 + openapi-typescript 7.13.0，不污染应用的 TS 7。

## 2. 核实方法

- npm 最新版本：读取 `https://registry.npmjs.org/<pkg>/latest` 的 `dist-tags.latest`、`engines`、`peerDependencies`。
- PyPI 最新版本：读取 `https://pypi.org/pypi/<pkg>/json` 的 `info.version`、`requires_python`。
- 本机实际版本：`apps/web/package.json`、`apps/api/.venv` 的 `pip list`、`node -v`、`pnpm -v`。
- 破坏性变更：Vite 迁移指南、Ant Design v5→v6 迁移文档、MapLibre 6.0.0 changelog / v5→v6 迁移指南、TypeScript 7.0 发布说明。
- 核实日期：2026-11-12。版本会继续变化，升级执行时应重新确认一次。

## 3. 当前版本 vs 最新稳定版

### 3.1 前端

| 包 | 当前 | 最新稳定版 | 升级跨度 | 风险 |
| --- | --- | --- | --- | --- |
| Node.js | 22.18.0 | 24 LTS（建议） | 大版本 | 低；Vite 8 最低要求已满足 |
| pnpm | 11.1.0 | 12.18.0 | 大版本 | 低；锁文件格式会变 |
| React / React DOM | 18.3.1 | 19.3.1 | 大版本 | 中；类型与少量 API |
| TypeScript | 7.0.2（已升级） | 7.0.2 | 已完成 | 低；应用 typecheck/build 已通过；旧编译器 API 仍需隔离 |
| Vite | 8.3.8（已升级） | 8.3.8 | 已完成 | 低；Rolldown 构建、开发服务器已冒烟 |
| `@vitejs/plugin-react` | 6.3.0（已升级） | 6.3.0 | 已完成 | 低；与 Vite 8 配套 |
| Ant Design | 5.29.3 | 6.7.0 | 大版本 | 高；DOM/CSS 变量/视觉回归 |
| `@ant-design/icons` | 5.6.1 | 6.3.4 | 大版本 | 中；必须与 AntD 6 配套 |
| MapLibre GL JS | 5.24.0 | 6.18.0 | 大版本 | 高；ESM-only、WebGL2、类型 |
| Zustand | 5.0.16 | 5.1.0 | 小版本 | 低 |
| React Router DOM | 6.30.6 | 7.18.5 | 大版本 | 低到中；`future` 参数需移除 |
| TanStack Query | 5.105.3 | 5.107.1 | 小版本 | 低 |
| dayjs | 1.11.13 | 1.11.23 | 补丁 | 低 |
| `@types/react` | 18.3.12 | 19.3.0 | 大版本 | 中；移除 pnpm override |
| `@types/react-dom` | 18.3.1 | 19.3.0 | 大版本 | 中 |
| `@types/node` | 未显式声明 | 26.6.6 | — | 低；Vite 8 可选 peer |
| openapi-typescript | 7.13.0（隔离使用） | 7.13.0 | 已最新 | 中；不支持 TS 7，需在独立 TS 5.9.3 环境运行 |

### 3.2 后端

| 包 | 当前 | 最新稳定版 | 备注 |
| --- | --- | --- | --- |
| Python | 3.13.14 | 3.13.x | 当前 venv 已是 3.13；方案文档写的 3.12 已过时 |
| FastAPI | 0.115.6 | 0.162.5 | 路由/依赖注入 API 稳定 |
| Starlette | 0.41.3 | 随 FastAPI | 由 FastAPI 约束 |
| Pydantic | 2.14.2 | 2.14.3 | 补丁 |
| pydantic-settings | 2.7.0 | 2.16.2 | 小版本 |
| SQLAlchemy | 2.0.36 | 2.1.8 | 大版本；需回归 ORM/查询 |
| GeoAlchemy2 | 0.16.0 | 0.21.0 | 需与 SQLAlchemy 2.1 一起验证 |
| psycopg | 3.2.3 | 3.3.8 | 驱动小版本 |
| uvicorn | 0.34.0 | 0.54.0 | 低风险 |
| python-docx | 1.1.2 | 1.2.0 | 低风险 |
| pytest | 8.3.4 | 9.2.0 | 大版本；本项目无插件依赖，风险可控 |
| cryptography | 44.0.0 | 50.0.2 | 大版本；Fernet 用法需回归 |
| alembic | 1.14.0 | 1.20.1 | 当前未使用；补迁移时再锁 |
| shapely | 2.0.6 | 2.2.0 | 当前业务未深度使用 |
| httpx | 0.28.1 | 0.28.1 | 已最新 |
| numpy | 2.5.4 | 2.5.4 | 已最新 |

> 后端最大的问题不是版本旧，而是此前**仓库没有 `requirements.txt` / `pyproject.toml` / `uv.lock`**。2026-11-12 已用 `pip freeze` 冻结到 `apps/api/requirements.lock.txt`，可以从仓库复现当前 venv；后续是否迁移到 `uv` 另议。

## 4. 为什么此前停留在旧版本？

不是这些版本“不能用新版本”，而是上一轮选型优先选择了当时互相验证过的组合：

- React 18 + Ant Design 5 是成熟组合；DELIVERY 记录过“AntD 5 与 React 19 的组合存在告警风险，先用成熟组合”。
- Vite 6 与 `@vitejs/plugin-react` 4 配套；Vite 8 需要 plugin-react 6。**2026-11-12 已升级到 Vite 8.3.8 + plugin-react 6.3.0。**
- TypeScript 5.9 是 Vite 6 时代的稳定选择。用户提到的“TypeScript 6”实际是 **5 → 7 的过渡/兼容桥接版本**，不是功能上的下一代；**2026-11-12 已升级到 7.0.2**。
- MapLibre 5 是当前地图代码验证过的版本；MapLibre 6 改 ESM-only 和 WebGL2，属于需要专门回归的升级。
- 后端此前没有锁文件，依赖是“装好能用”状态，没有被持续升级；现在已冻结基线。

所以答案是：**能改，而且现在适合改；但要把“升级”当成一次有验证门槛的迁移，而不是改版本号。**

## 5. 关键破坏性变更与代码影响

### 5.1 TypeScript 7.0

- TS 7 是原生编译器（Go 实现），稳定版不提供旧版编译器 API。本项目自身只用 `tsc`，没有直接调用编译器 API；但 `openapi-typescript@7.13.0` 会调用 `ts.factory`，实测在 TS 7 下直接崩溃。已改为 `pnpm codegen:api`，用 `pnpm dlx` 在独立环境安装 TypeScript 5.9.3 + openapi-typescript 7.13.0。
- TS 7 不再自动把 `@types/geojson` 的全局命名空间带入项目，`GeoJSON.Feature` 等类型会报 `TS2503`。已在 `src/vite-env.d.ts` 显式加入 `/// <reference types="geojson" />`。
- 旧配置项会收紧：`baseUrl`、`moduleResolution: "node"/"node10"` 等需要调整。`apps/web/tsconfig.json` 原有 `baseUrl` 和 `paths`，但源码没有使用 `@/` 别名（已核对），已删除这两项。
- `tsc -b` 仍可用；但若引入 project references，需要 `composite` 等配置。
- 升级后先跑 `pnpm typecheck`，不要直接跑 build，便于把类型错误和打包错误分开。

### 5.2 Vite 8 + plugin-react 6

- Node 要求 `^20.19.0 || >=22.12.0`；当前 Node 22.18.0 满足，Node 24 LTS 更稳妥。
- Vite 8 使用 Rolldown/Oxc；`build.rollupOptions.output.manualChunks` 的对象形式已被移除，函数形式也已弃用。本次已改用 `build.rolldownOptions.output.codeSplitting.groups`（react / maplibre / antd 三组），构建产物分块与升级前一致。`build.rollupOptions` 本身也已改名为 `build.rolldownOptions`。
- `@vitejs/plugin-react@6` 的 peer 要求 Vite `^8.0.0`，不能只升 Vite 不升插件。
- 建议同时检查 `chunkSizeWarningLimit`、产物文件名和 sourcemap 行为；升级后对比 chunk 体积。

### 5.3 React 19 + React Router 7

- React 19 移除了部分旧 API（如 `ReactDOM.render`、函数组件 `defaultProps`、字符串 ref 等）。当前代码用 `createRoot`、函数组件和 hooks，预计改动不大，但 `@types/react@19` 会对 `useRef`、`ReactNode`、事件类型更严格。
- `apps/web/pnpm-workspace.yaml` 目前把 `@types/react` 固定为 18.3.12，是为了绕开 React 18 类型冲突；升级 React 19 时必须删除这条 override。
- React Router 7 仍提供 `BrowserRouter`、`Routes`、`Route`、`useNavigate` 等 API，但 `BrowserRouter` 的 `future` 参数要移除。当前 `main.tsx` 有 `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}`，删除即可。
- 如果后续想用 React Router 7 的 data router（`createBrowserRouter`），可以另开任务，不要和这次升级混在一起。

### 5.4 Ant Design 6 + icons 6

- AntD 6 要求 `@ant-design/icons >= 6`，必须成对升级。
- 默认启用 CSS 变量，部分组件 DOM 结构、类名和样式注入方式变化。当前 `styles.css` 对 `.ant-tooltip`、`.ant-modal-content`、`.ant-modal-header`、`.ant-notification-notice` 等有深度覆盖，这是最大视觉风险。
- `destroyOnClose`、`bodyStyle`、`headStyle` 等旧 API 在 v6 中已调整或移除。当前代码未命中这些（已检索），但有 4 处 `size="middle"` 需要升级后确认是否仍受支持。
- `theme` token 中个别字段可能被移除或改名；`theme/antd.ts` 的 `wireframe`、组件级 token 需要以运行时/类型报错为准。
- 必须做视觉回归：Tooltip 箭头、Modal 标题栏/关闭按钮、Notification、Table、Tabs、Button、Input、Select、DatePicker、TimePicker，以及深浅两套主题。

### 5.5 MapLibre GL JS 6

- 6.0 起 **ESM-only**，不再发布 UMD bundle；默认导入 `import maplibregl from "maplibre-gl"` 要改为命名空间导入或命名导入：
  ```ts
  import * as maplibregl from "maplibre-gl";
  import { LngLatBounds, Map as MapLibreMap } from "maplibre-gl";
  ```
  当前 `MapCanvas.tsx` 第 5 行正是默认导入，必须改。
- 要求 **WebGL2**；不支持 WebGL2 的设备需要明确降级提示，不能白屏。当前没有专门 fallback，升级时补一个最小提示或至少验证目标浏览器。
- style spec 升级到 25；当前 `styleFor()` 只用了 sources/layers 的基础字段，预计兼容，但要实际渲染高德/天地图/空白三种底图。
- 事件与类型有变化（例如 `styleimagemissing` 变为 notify-only）；当前用到的 `MapGeoJSONFeature`、`Popup`、`Marker`、`LngLatBounds` 需要按新类型修正。
- CSS 引入路径 `maplibre-gl/dist/maplibre-gl.css` 仍可用，但要确认 package exports 允许。

### 5.6 后端大版本

- **SQLAlchemy 2.1**：ORM 查询、`Session`、`select()` 基本兼容，但 2.1 会移除一些 2.0 的弃用行为；需要跑完整集成测试，尤其是 `FOR UPDATE`、关系加载、GeoAlchemy2 几何类型。
- **GeoAlchemy2 0.21**：与 SQLAlchemy 2.1 一起升级，单独升级容易出现兼容问题。
- **FastAPI 0.162 / Starlette**：路由、依赖注入、异常处理预计兼容；重点回归 `RequestValidationError`、CORS、静态文件挂载和 OpenAPI 生成。
- **pytest 9**：本项目没有 pytest 插件依赖，风险较低；但 `conftest.py` 的 fixture 作用域、`pytest.ini` 选项需要回归。
- **cryptography 50**：Fernet 接口稳定；重点回归地图 Key 的加密/解密/掩码。
- **python-docx 1.2**：DOCX 渲染 API 稳定；仍需人工用 Word/WPS 打开检查中文字体、分页和长表格。
- 升级前先 `pip freeze` 冻结当前环境；升级后用 `pip check` 检查依赖冲突。

## 6. 推荐升级顺序

### 第 0 步：建立可回滚基线（已完成 2026-11-12）

1. 已确认 `pnpm-lock.yaml` 与 `apps/api/.venv` 可用；Git 基线为 `35a64b1`。
2. 已生成 `apps/api/requirements.lock.txt`（`pip freeze`，50 行）。本机没有 `uv`，暂不引入。
3. 已运行基线验证：
   - `pnpm typecheck` / `pnpm build` 通过（Vite 6 基线，构建 9.3s）。
   - 纯逻辑 `pytest` 16 passed；全量 16 passed / 16 skipped，原因是未设置 `TEST_DATABASE_URL`。
   - 手动冒烟：登录 → 行程列表 → 工作台 → 地图画布 → 时间线。
4. 已记录构建产物体积和测试通过数；不把运行数据或截图提交进仓库。
5. 基线已提交并推送，后续升级可用 `git diff` 定位与回滚。

### 第 1 步：工具链（Node / pnpm / Vite / TS）（已完成 2026-11-12）

1. Node 保持 22.18.0（满足 Vite 8 的 `^20.19.0 || >=22.12.0`）；pnpm 保持 11.1.0，升级 12.x 另开任务。
2. 已升级 `vite@8.3.8`、`@vitejs/plugin-react@6.3.0`、`typescript@7.0.2`。
3. `vite.config.ts` 已改用 `build.rolldownOptions.output.codeSplitting.groups`；`tsconfig.json` 已删除 `baseUrl`/`paths`；`vite-env.d.ts` 显式引用 geojson。
4. 已验证：`pnpm peers check` 无问题、`pnpm typecheck` 0 错、`pnpm build` 通过（约 0.7s）、Vite 8 开发服务器与生产构建均可打开登录页，演示账号可进入工作台和地图。
5. `openapi-typescript` 已隔离到 `pnpm codegen:api` 的 TS 5.9.3 环境。
6. React/AntD/MapLibre/Router 未改，留到第 2、3 步。

### 第 2 步：React / Router / AntD / 状态库

1. 删除 `pnpm-workspace.yaml` 的 `@types/react` override。
2. 升级 React 19、React DOM 19、`@types/react` 19、`@types/react-dom` 19。
3. 升级 React Router 7，删除 `BrowserRouter` 的 `future` 参数。
4. 升级 AntD 6 + icons 6；先让 `tsc` 通过，再做视觉回归。
5. 升级 Zustand 5.1、TanStack Query 5.107、dayjs 1.11.23（小版本可以同批）。
6. 重点回归 `styles.css` 的 `.ant-*` 覆盖、深浅主题、弹窗/提示/通知/表格。
7. 通过后提交一个“UI 栈升级”提交。

### 第 3 步：MapLibre 6

1. 改默认导入为命名空间导入/命名导入。
2. 修正事件与类型错误。
3. 验证 WebGL2、三种底图、标注、Popup、测距、指北针、图层、路线显示。
4. 对不支持 WebGL2 的环境补明确提示（至少不要白屏）。
5. 通过后提交一个“地图引擎升级”提交。

### 第 4 步：后端依赖

1. 先补 `pyproject.toml` + `uv.lock`（或 `requirements.txt` 精确锁）。
2. 按依赖组升级：FastAPI/Starlette → SQLAlchemy/GeoAlchemy2 → 其余。
3. 跑纯逻辑测试，再跑 PostgreSQL/PostGIS 集成测试。
4. 重新生成 OpenAPI，确认前端 `schema.d.ts` 只有预期差异。
5. 手工验证 Key 加密、导出 DOCX、分享、历史恢复。
6. 通过后提交一个“后端依赖升级”提交。

### 第 5 步：Docker 化（可与后端升级并行）

用户已表示本机可以安装 Docker。建议顺序：

1. 安装 Docker Desktop + WSL2 后端（需要管理员权限，可能要重启）。
2. 先只容器化 PostgreSQL/PostGIS，拿到可重复的测试库。
3. 再补 `api`、`web`（Nginx）服务；Redis/RQ 等到任务队列真正替换时再加。
4. 使用命名卷存数据库和 `data/`，健康检查，密钥只从环境变量/未提交的 `.env` 注入。
5. 保留现有 `dev.cmd` 的本机开发方式，不强制所有人用容器。

## 7. 验证清单

> 以下勾选只代表 2026-11-12 工具链升级批次已完成的项，不代表整个产品验收完成；未勾选项仍需在后续 React/AntD/MapLibre/后端升级或完整验收时执行。

### 7.1 前端

- [x] `pnpm install` 无 peer 冲突；`pnpm-lock.yaml` 已更新。
- [x] `pnpm typecheck` 0 错。
- [x] `pnpm build` 通过；MapLibre/AntD chunk 各约 1MB，与升级前接近。
- [x] `pnpm dev` 启动，`/api` 代理正常。
- [ ] 登录/注册/验证码/退出（本次只验证了演示账号登录与工作台，未回归注册/验证码 UI）。
- [ ] 工作台：地图三种底图、标注、右键新增、测距、指北针、图层、路线显示（本次只验证地图画布与时间线渲染）。
- [ ] AntD：Modal、Tooltip、Notification、Table、Tabs、DatePicker、TimePicker、Select、Button、Input。
- [ ] 深浅主题各走一遍；无残留深色气泡/错位箭头。
- [ ] 攻略预览、导出、历史版本、恢复、分享解锁/复制。
- [ ] 设置页：地图 Key 掩码/保存/测试、账号、会话。
- [ ] 390×844 手机视口无横向溢出；核心操作不依赖拖拽。
- [x] 浏览器控制台无 pageerror（登录页、行程列表、工作台、生产构建均已检查）。

### 7.2 后端

- [x] `pip check` 无冲突；`python -c "from app.main import app"` 成功。
- [ ] `pytest tests -q` 全部通过（含 PostgreSQL/PostGIS 集成）；当前 16 passed / 16 skipped，缺 `TEST_DATABASE_URL`。
- [x] `scripts/gen_openapi.py` 生成成功；`pnpm codegen:api` 生成类型无意外 diff。
- [ ] 登录/会话/CSRF/限流/越权 404。
- [ ] 行程写事务、If-Match 409/428、快照、恢复。
- [ ] 时间线冲突、优化任务、任务取消/重试。
- [ ] MD/DOCX 导出、7 天过期、下载鉴权。
- [ ] 分享创建/密码/撤销/复制。
- [ ] 地图 Key 加密/解密/掩码/测试。

### 7.3 发布前

- [x] 锁文件（`apps/web/pnpm-lock.yaml`、`apps/api/requirements.lock.txt`）已更新并随本批提交。
- [ ] 容器镜像/数据库版本固定，不用 `latest`。
- [ ] `.env`、`data/`、`*.tsbuildinfo`、`.workbuddy/`、Edge profile 未被提交。
- [ ] 前端包、接口响应、日志中无服务端 Key。
- [x] 升级说明和回滚步骤写入 README / DELIVERY。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| AntD 6 DOM 变化导致自定义 CSS 失效 | 中高；弹窗/提示错位 | 先升级类型，再逐组件视觉回归；必要时改用 `classNames`/`styles` API，减少 `.ant-*` 直接覆盖 |
| MapLibre 6 默认导入直接报错 | 高；地图白屏 | 第一步改导入；构建后立刻跑工作台 |
| WebGL2 不可用 | 中；旧设备无地图 | 捕获初始化失败，显示“浏览器不支持 WebGL2”的明确提示，保留日程/攻略可用 |
| Vite 8 `manualChunks` 配置失效 | 中；构建失败或 chunk 变化 | 改函数/`advancedChunks`；对比产物 |
| TS 7 旧配置报错 | 中；类型检查失败 | 删除 `baseUrl`/`paths`；逐项修 `tsconfig` |
| SQLAlchemy 2.1 + GeoAlchemy2 不兼容 | 中高；几何读写失败 | 两者一起升；先跑 PostGIS 集成测试 |
| 没有 Python 锁文件，升级后无法回退 | 高 | 升级前 `pip freeze`；提交锁文件 |
| 一次性升级太多，无法定位回归 | 高 | 按第 6 节分提交；每步可回滚 |
| AntD 6 / React 19 类型冲突 | 中 | 删除 `@types/react` 18 override；统一 19.3.x |
| 视觉变化被当成 bug | 低 | 先记录基线截图；升级后逐页对比，接受合理变化并记录 |

## 9. 待确认的决策（更新于 2026-11-12）

1. **升级范围**：工具链已单独完成；下一步建议先做 React / Router / AntD，再做 MapLibre，最后处理后端依赖。
2. **Node 版本**：本次保持 Node 22.18.0（满足 Vite 8 要求）；是否安装 Node 24 LTS 待定。
3. **pnpm 版本**：本次保持 11.1.0；是否升级 12.18.0 待定，升级会改动锁文件格式。
4. **Docker**：尚未安装；是否现在安装 Docker Desktop + WSL2、先补 PostgreSQL/PostGIS Compose，待确认。
5. **AntD 6 视觉变化**：是否接受默认视觉调整，需要预留逐组件调样式的时间。
6. **Python 依赖管理**：本次用 `requirements.lock.txt` 冻结全部依赖；是否迁移到 `uv`/`uv.lock` 待定，本机目前没有 `uv`。

## 10. 已执行的第一批实际改动（2026-11-12）

```text
chore(web): upgrade toolchain to vite 8 and typescript 7
- freeze Python environment to apps/api/requirements.lock.txt
- upgrade vite 8.3.8, @vitejs/plugin-react 6.3.0, typescript 7.0.2
- migrate manualChunks to Rolldown codeSplitting groups
- remove tsconfig baseUrl/paths and reference @types/geojson explicitly
- isolate openapi-typescript under TypeScript 5.9.3 via pnpm dlx
- keep React 18 / AntD 5 / MapLibre 5 / Router 6 unchanged
```

第二个提交再升级 React/AntD/Router，第三个提交升级 MapLibre，第四个提交处理后端依赖。这样每一层都能单独验证、单独回滚。

---

相关文档：

- [架构说明](ARCHITECTURE.md)
- [实现方案](IMPLEMENTATION_PLAN.md)
- [API 契约](API_CONTRACT.md)
- [验收清单](ACCEPTANCE.md)
- [交付与差异](DELIVERY.md)
