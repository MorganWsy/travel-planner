# 技术栈升级评估（2026-11-12）

本文只做版本核实与升级设计，**尚未修改任何依赖、尚未执行安装或构建**。实际安装、构建和提交需要确认后执行。

## 1. 结论

可以升级，而且建议升级，但不建议“把 package.json 里的版本号一把替换再祈祷能跑”。当前项目是一套能运行的纵向闭环，升级的主要风险不在业务代码，而在三处：

1. **Ant Design 6 改变了 DOM 与 CSS 变量机制**，而 `styles.css` 有大量 `.ant-*` 直接覆盖。
2. **MapLibre 6 改为 ESM-only、要求 WebGL2**，当前是默认导入，必须改命名空间导入，并做地图回归。
3. **Vite 8 切换到 Rolldown/Oxc**，当前 `manualChunks` 对象写法需要调整；TypeScript 7 的原生编译器也会对旧 `tsconfig` 选项更严格。

推荐分四步走：**先冻结基线 → 再升级工具链 → 再升级 UI/React → 最后升级 MapLibre 与后端依赖**。每一步都能独立回滚，不要把所有大版本塞进一个无法定位问题的提交。

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
| TypeScript | 5.9.3 | 7.0.2 | 两个大版本 | 中高；原生编译器、旧配置项 |
| Vite | 6.4.5 | 8.3.8 | 两个大版本 | 高；Rolldown、配置变更 |
| `@vitejs/plugin-react` | 4.7.0 | 6.3.0 | 两个大版本 | 高；要求 Vite 8 |
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
| openapi-typescript | 7.13.0 | 7.13.0 | 已最新 | 低 |

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

> 后端最大的问题不是版本旧，而是**仓库没有 `requirements.txt` / `pyproject.toml` / `uv.lock`**。当前 venv 无法从仓库可重复重建。升级前必须先把现有环境冻结成清单，否则“升级失败”时连原样都回不去。

## 4. 为什么当前会停在旧版本？

不是这些版本“不能用新版本”，而是上一轮选型优先选择了当时互相验证过的组合：

- React 18 + Ant Design 5 是成熟组合；DELIVERY 记录过“AntD 5 与 React 19 的组合存在告警风险，先用成熟组合”。
- Vite 6 与 `@vitejs/plugin-react` 4 配套；Vite 8 需要 plugin-react 6。
- TypeScript 5.9 是 Vite 6 时代的稳定选择。用户提到的“TypeScript 6”实际是 **5 → 7 的过渡/兼容桥接版本**，不是功能上的下一代；当前 npm 最新是 **7.0.2**。
- MapLibre 5 是当前地图代码验证过的版本；MapLibre 6 改 ESM-only 和 WebGL2，属于需要专门回归的升级。
- 后端没有锁文件，依赖是“装好能用”状态，没有被持续升级。

所以答案是：**能改，而且现在适合改；但要把“升级”当成一次有验证门槛的迁移，而不是改版本号。**

## 5. 关键破坏性变更与代码影响

### 5.1 TypeScript 7.0

- TS 7 是原生编译器（Go 实现），稳定版暂不提供旧版编译器 API；如果工具有 `import ts from "typescript"` 之类的用法，需要等 7.1 或改用 CLI。本项目目前只用 `tsc` 做类型检查，不直接调用编译器 API，影响较小。
- 旧配置项会收紧：`baseUrl`、`moduleResolution: "node"/"node10"` 等需要调整。当前 `apps/web/tsconfig.json` 有 `baseUrl` 和 `paths`，但源码里没有使用 `@/` 别名（已核对），可以直接删除这两项。
- `tsc -b` 仍可用；但若引入 project references，需要 `composite` 等配置。
- 升级后先跑 `pnpm typecheck`，不要直接跑 build，便于把类型错误和打包错误分开。

### 5.2 Vite 8 + plugin-react 6

- Node 要求 `^20.19.0 || >=22.12.0`；当前 Node 22.18.0 满足，Node 24 LTS 更稳妥。
- Vite 8 使用 Rolldown/Oxc；`build.rollupOptions.output.manualChunks` 的**对象形式**不再适用。当前 `vite.config.ts` 正是对象形式，需要改成函数形式或 Rolldown 的 `advancedChunks` 分组。
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

### 第 0 步：建立可回滚基线（必须先做）

1. 确认当前 `pnpm-lock.yaml` 与 `apps/api/.venv` 可用。
2. 生成 Python 依赖清单：优先 `uv`（方案指定），没有 uv 就 `pip freeze > requirements.lock.txt`。
3. 运行一次基线验证：
   - `pnpm typecheck` / `pnpm build`
   - `pytest tests -q`（需要 `TEST_DATABASE_URL` 指向 PostGIS 测试库）
   - 手动冒烟：登录 → 工作台 → 地图 → 导出 → 分享 → 历史。
4. 记录构建产物体积、页面截图、测试通过数。
5. 提交当前状态，确保任何升级都能 `git diff` 定位、能回滚。

### 第 1 步：工具链（Node / pnpm / Vite / TS）

1. 安装 Node 24 LTS（可选；Node 22.18 已满足 Vite 8 最低要求）。
2. 升级 pnpm 到 12.x。
3. 升级 `vite@8`、`@vitejs/plugin-react@6`、`typescript@7`。
4. 修改 `vite.config.ts` 的 `manualChunks`；修改 `tsconfig.json`，删除 `baseUrl`/`paths`。
5. 只跑类型检查和构建，不碰 React/AntD/MapLibre。
6. 通过后提交一个“工具链升级”提交。

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

### 7.1 前端

- [ ] `pnpm install` 无 peer 冲突；锁文件已更新并提交。
- [ ] `pnpm typecheck` 0 错。
- [ ] `pnpm build` 通过；记录 chunk 体积，MapLibre/AntD 不异常膨胀。
- [ ] `pnpm dev` 启动，`/api` 代理正常。
- [ ] 登录/注册/验证码/退出。
- [ ] 工作台：地图三种底图、标注、右键新增、测距、指北针、图层、路线显示。
- [ ] AntD：Modal、Tooltip、Notification、Table、Tabs、DatePicker、TimePicker、Select、Button、Input。
- [ ] 深浅主题各走一遍；无残留深色气泡/错位箭头。
- [ ] 攻略预览、导出、历史版本、恢复、分享解锁/复制。
- [ ] 设置页：地图 Key 掩码/保存/测试、账号、会话。
- [ ] 390×844 手机视口无横向溢出；核心操作不依赖拖拽。
- [ ] 浏览器控制台无 pageerror；无 MapLibre/React 警告。

### 7.2 后端

- [ ] `pip check` 无冲突；`python -c "from app.main import app"` 成功。
- [ ] `pytest tests -q` 全部通过（含 PostgreSQL/PostGIS 集成）。
- [ ] `scripts/gen_openapi.py` 生成成功；`openapi-typescript` 生成类型无意外 diff。
- [ ] 登录/会话/CSRF/限流/越权 404。
- [ ] 行程写事务、If-Match 409/428、快照、恢复。
- [ ] 时间线冲突、优化任务、任务取消/重试。
- [ ] MD/DOCX 导出、7 天过期、下载鉴权。
- [ ] 分享创建/密码/撤销/复制。
- [ ] 地图 Key 加密/解密/掩码/测试。

### 7.3 发布前

- [ ] 锁文件（`pnpm-lock.yaml`、`uv.lock` 或 `requirements.lock.txt`）已提交。
- [ ] 容器镜像/数据库版本固定，不用 `latest`。
- [ ] `.env`、`data/`、`*.tsbuildinfo`、`.workbuddy/`、Edge profile 未被提交。
- [ ] 前端包、接口响应、日志中无服务端 Key。
- [ ] 升级说明和回滚步骤写入 README / DELIVERY。

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

## 9. 需要确认的决策

在开始改依赖前，请确认以下事项：

1. **升级范围**：前端 + 后端一起做，还是先做前端？建议先前端工具链/UI/地图，后端单独一批。
2. **Node 版本**：是否安装 Node 24 LTS？当前 22.18.0 已满足 Vite 8，不装也能做。
3. **Docker**：是否现在安装 Docker Desktop + WSL2？如果现在装，我可以先补一个只含 PostgreSQL/PostGIS 的 Compose，降低测试库门槛。
4. **AntD 6 视觉变化**：是否接受 AntD 6 带来的默认视觉调整？如果不接受，需要预留逐组件调样式的时间。
5. **Python 依赖管理**：用 `uv`（方案指定）还是先用 `requirements.txt` 精确锁？本机目前没有 `uv`。

## 10. 建议的第一批实际改动（待确认后执行）

如果确认升级，我建议第一个提交只做“可回滚的基础设施”，不碰业务逻辑：

```text
chore(web): freeze baseline and upgrade toolchain
- 记录当前依赖/构建/测试基线
- 升级 vite 8、@vitejs/plugin-react 6、typescript 7
- 调整 vite.config.ts 的 manualChunks
- 移除 tsconfig 的 baseUrl/paths
- 不改 React/AntD/MapLibre
```

第二个提交再升级 React/AntD/Router，第三个提交升级 MapLibre，第四个提交处理后端依赖与锁文件。这样每一层都能单独验证、单独回滚。

---

相关文档：

- [架构说明](ARCHITECTURE.md)
- [实现方案](IMPLEMENTATION_PLAN.md)
- [API 契约](API_CONTRACT.md)
- [验收清单](ACCEPTANCE.md)
- [交付与差异](DELIVERY.md)
