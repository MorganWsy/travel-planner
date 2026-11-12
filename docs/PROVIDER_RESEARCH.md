# 地图数据源及技术事实核实记录

记录日期：2026-11-03，Asia/Shanghai。用途：为后续实现提供证据边界和联调模板；不是已经通过的供应商验收报告。

## 1. 用户确认与截图信息

用户确认：已经申请天地图Key和高德Key，允许两者作为数据源。Key具体值未提供，本次没有读取其他项目凭据、调用真实计费API或检查账号控制台。

### 天地图截图

基础服务选项包括：JavaScriptApi、静态地图服务、公交服务、逆地理编码服务、地理编码服务、三维地名服务、三维地形服务、行政区划服务、驾车服务、搜索服务v2.0、瓦片服务。

这说明用户提供的服务目录包含这些项；具体Key平台、调用权限、额度、返回字段、投影以及缓存/导出范围仍需项目专用配置后核实。

### 高德截图

平台选中“Web服务”，并非“Web端(JS API)”。目录显示：静态地图、地理编码、逆地理编码、关键字搜索、周边搜索、多边形搜索、ID查询、输入提示、路径规划、坐标转换、行政区划查询、IP定位、天气查询、矩形/圆形/指定线路交通态势、地理围栏、猎鹰服务、GeoHUB等API入口。

首版只接入与旅游规划有关的查询、路径、天气和可用静态图；不因截图出现入口而引入围栏、轨迹监控或GeoHUB。Web服务Key放后端；不拿它初始化高德浏览器JS SDK。

截图作为本次用户需求证据，不复制其临时路径到工程运行配置。辅助识图脚本本次返回DNS错误 getaddrinfo ENOTFOUND open.bigmodel.cn；没有获得该脚本的成功识别结果。上述服务目录按用户消息中可见截图记录。

## 2. 已查官方资料与可支持的结论

| 资料 | 当前能确认的内容 | 不能据此推断 |
| --- | --- | --- |
| [天地图·开封官方节点](https://henan.tianditu.gov.cn/kaifeng/) | 有影像、注记、地名搜索、驾车、公交、地理编码、行政区划、静态地图开发入口 | 当前用户Key实际额度、完整字段或所有内容可持久化/导出 |
| [高德POI搜索文档](https://lbs.amap.com/api/webservice/guide/api-advanced/search) | 官方有POI搜索类Web服务文档 | 所有景点有门票、开放时间、图片或用户评论 |
| [高德路径规划文档](https://lbs.amap.com/api/webservice/guide/api/direction) | 官方有路径规划类服务入口 | 各模式都已开通、批量矩阵可用或结果等同实时班次 |
| [高德坐标转换文档](https://lbs.amap.com/api/webservice/guide/api/convert) | 文档描述非高德坐标到高德坐标，示例输入经度在前 | 官方提供GCJ02反向WGS84转换，或改SRID即可消除偏移 |
| [高德服务协议](https://lbs.amap.com/pages/terms) | 使用、保存、缓存和脱离服务用途有单独限制，需要按对应授权处理 | Key/调用额度等于跨地图展示、保存、离线和文档导出的全部许可 |
| [MapLibre数据源规范](https://maplibre.org/maplibre-style-spec/sources/) | raster、vector、geojson、raster-dem等数据源各有格式约定 | 任意天地图三维地形或原始DEM文件可直接作为raster-dem |
| [GDAL COG](https://gdal.org/en/stable/drivers/raster/cog.html) | 可生成适合分块读取的Cloud Optimized GeoTIFF | COG自动等同Terrain-RGB或自动完成高程基准转换 |
| [TiTiler COG接口](https://developmentseed.org/titiler/endpoints/cog/) | 提供COG瓦片和相关接口能力 | 用户可直接向公开url参数提交任意私有地址 |
| [FastAPI后台任务](https://fastapi.tiangolo.com/tutorial/background-tasks/) | 重计算可使用独立任务处理工具 | async函数自动让CPU密集求解不阻塞 |
| [GeoAlchemy2](https://geoalchemy-2.readthedocs.io/en/latest/) | SQLAlchemy的空间数据库扩展，支持PostGIS | ORM替代空间索引、SQL和CRS设计 |
| [RQ Worker](https://python-rq.org/docs/workers/) | Worker处理阻塞任务；常规Worker有fork模型 | Windows原生环境与LinuxWorker行为完全一致 |
| [OR-Tools时间窗口示例](https://developers.google.com/optimization/routing/vrptw) | 可建模旅行时间与时间窗口约束 | 内置完整旅游偏好或公交时刻表优化 |
| [python-docx](https://python-docx.readthedocs.io/en/latest/) | 创建和更新DOCX文件 | 无需排版验收或能直接提供PDF渲染 |
| [PWA离线机制](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation) | Service Worker支持专门实现离线功能 | 安装PWA即自动得到离线攻略或所有手机行为一致 |
| [Electron安全文档](https://www.electronjs.org/docs/latest/tutorial/security) | 说明renderer隔离、Node集成和远程内容相关要求 | Electron可取代手机Web或无需安全边界 |
| [eviltransform源码](https://github.com/googollee/eviltransform)、[许可证](https://github.com/googollee/eviltransform/blob/master/LICENSE) | 有Python WGS84/GCJ02转换与迭代逆算法，需保留源/二进制再分发声明 | 该算法是官方测绘转换、覆盖精确国界或算法许可证授予供应商数据使用权 |

这些是公开文档核实。版本、配额和账号状态在部署时仍需复查；本文不锁定最新Electron版本为永远可用版本。

## 3. 本次访问失败或不确定事项

- 天地图主站 MapService.html、search2.html、search.html、drive.html、bus.html多次访问超时。主站超时不能被推断成平台不提供服务，也不能用地区节点导航替代完整API参数说明。
- 高德部分旧路径（包括本次访问的distance、inputtips旧地址）重定向到了地理编码页面；direction-v2页面本次工具无法访问，weatherinfo旧地址超时。
- 因此不能直接从旧教程复制接口地址；P0必须从当前官方开发入口找到正确版本，核对最终页面标题、请求地址、参数和真实响应。
- 没有使用任何真实Key，本次没有验证任一API账户的成功响应、QPS、计费或日/月额度。
- 未获取供应商针对本应用混合底图、数据留存、历史/分享/导出/离线用途的具体授权证据；相关用途在能力报告中保持unknown，按方案提供自有/明确授权数据路径。

## 4. P0能力矩阵模板

后续实施在本节下新增实测记录，保留本次状态，避免把计划覆盖成历史事实。验证环境仅使用项目专用Key，输出脱敏报告。

| provider | capability | 当前技术状态 | 当前扩展用途状态 | 实施选择 |
| --- | --- | --- | --- | --- |
| 天地图 | 道路/影像/注记 | 用户已申请Key，未实测 | 保存/导出等unknown | 底图首选，先核实官方瓦片规范 |
| 天地图 | POI/编码/行政区划 | 目录有能力，未实测 | 持久化/分享/导出unknown | 默认搜索候选 |
| 天地图 | 驾车/公交 | 目录有能力，未实测 | 混合展示/留存unknown | 路径备选 |
| 天地图 | 步行/天气 | 未核实，不从其他能力推断 | unknown | 不宣称支持 |
| 天地图 | 三维地形 | 目录有能力，格式未核实 | 转换/再发布unknown | 自有DEM为保证路径，验证通过再加 |
| 天地图 | 静态地图 | 目录有能力，未实测 | 存储/导出unknown | 攻略配图候选 |
| 高德 | POI/提示/编码 | Web服务目录有入口，未实测 | 混合展示/留存等unknown | 搜索可切换 |
| 高德 | 驾车/步行/公交 | 路径入口及公开文档存在，具体模式未实测 | 混合展示/计算/留存等unknown | 用途和能力可用时路径优先 |
| 高德 | 天气/静态图 | 截图有入口，未实测 | 导出等unknown | 可选天气与攻略配图 |

每个实测条目必须包含：

1. 测试日期、环境、Key平台类别和脱敏标识，不含Key值。
2. 官方文档URL、页面标题/版本、最终请求方法及路径。
3. 输入/输出坐标系、单位、分页、范围/条数/模式、是否支持出发时间和批量。
4. 脱敏成功/空结果/鉴权失败/超额/不可达的应用映射结果，不保留禁止存储的原始正文。
5. 控制台或正式资料确认的QPS/并发/日/月额度与计费说明日期，不用应用保护值充当供应商限额。
6. 各用途状态、允许字段、保留期、attribution和证据位置；证据不放密钥或个人信息。
7. 是否启用、关闭原因、fallback；测试费用或请求计数。

## 5. 供应商接口验证样本

- 城市：北京、杭州、成都；关键词各取景点、公交站、汽车站、火车站、机场和一个不存在的名称，不做全城批量抓取。
- 搜索：指定城市、附近和范围；确认不同同名地点、返回条数、分类以及详情ID可用性。
- 路径：短距驾车、步行、跨区公交、明显不可达输入；公交分别给两个出发时刻检查语义。
- 坐标：自有已知位置、供应商返回位置、地图叠加及库的lat/lng参数顺序；迭代逆输出标记近似。
- 静态图：来源标识、中文注记、用户自有标注叠加和允许的文档保存方式；验证失败使用明确示意图。
- 所有请求受预算和QPS保护；不使用压测探测供应商上限。

## 6. 不阻塞开发的替代路径

未配置/未开通/用途未明确的能力保持关闭或适用的只读在线模式。自有地点、允许导入的GIS数据、自建交通矩阵可完成账号、行程、历史、优化逻辑、MD/DOCX、自有数据分享与离线的全链路开发。

替代路径只证明应用逻辑可行；生产开启某项真实供应商能力前，仍需完成它对应的实测和用途核实。用户后续提供的明确授权或新需求应直接更新能力配置及相关文档，不重复提出已经解决的授权问题。

## 7. 2026-11-10 新增路线能力的实测记录

本节只记录本轮实际打过的请求，不把「文档有入口」写成「用途已获授权」。用途状态仍以 `config/provider_policy.json` 为准。

| 项 | 实测结果 |
| --- | --- |
| 依据 | 高德《路径规划 2.0》<https://lbs.amap.com/api/webservice/guide/api/newroute>（页面标注最后更新 2026-06-17） |
| 新增端点 | `GET /v5/direction/bicycling`、`GET /v5/direction/electrobike`；参数 `origin`、`destination`、`show_fields=cost,polyline` |
| 返回字段 | 与驾车/步行不同：`route.paths[0].duration` 是基础字段，`cost` 不返回；`steps[].polyline` 需 `show_fields` 才返回 |
| 本机实测 | 2026-11-10，项目专用高德 Web 服务 Key，南昌示例行程第 1→2 个事项；自行车 1482 m / 531 s、电动车同量级、驾车 2632 m / 975 s、步行 1469 m / 1175 s；四种均返回几何 |
| 公交 | `v3/direction/transit/integrated` 带 `city_code=0791` 返回 2013 m / 1536 s，该样本未返回 `polyline`，因此地图上没有实际路线几何，只有耗时 |
| 坐标系 | 入参 WGS84→GCJ02，出参 polyline GCJ02→WGS84 后存内存；不写入数据库 |
| 用途 | `display_on_custom_map=allowed`；`persist=unknown`、`share/export/offline=denied`。路网几何只在本次浏览器会话显示，刷新即消失；保存的是用户手工录入的耗时 |
| 未核实 | 日/月额度、并发、计费、失败码全量映射、不同城市与出发时刻的公交语义。能力报告里的 `verified` 仍为 false |

`duration` 缺失时返回 `status=partial` 并显式提示手工录入，不用距离除以固定速度推算耗时。

### 7.1 高德 v5 周边搜索字段（2026-11-12）

| 项 | 实测结果 |
| --- | --- |
| 端点 | `GET /v5/place/around`，南昌西湖区示例点 |
| 区县 | 基础响应包含 `adname`（如“西湖区”）、`cityname`、`adcode`、`pname`，不需要额外参数 |
| 扩展字段 | `show_fields=business` 增加 `business.tel`、`business.rating` 等；项目用它补电话，兼容旧版顶层 `tel` / `biz_ext.tel` |
| 分页 | `page_size` 最大 25，`page_num` 翻页；项目采集在 `limit > 25` 时继续翻页 |
| 历史数据 | 早期入库的点位没有保存 `adname`；重新采集同名点位会回填，演示景点图层的 51 个旧点已用批量逆地理编码补齐 |

## 8. MapLibre 演示底图的评估（2026-11-10）

- 实测环境：本机直连（绕过本地代理），`https://demotiles.maplibre.org/style.json` 三次 TTFB 0.45–0.47 s、总 0.53–0.62 s、HTTP 200；`tiles/0/0/0.pbf` 三次总 0.62–0.63 s、HTTP 200。速度可用，不是访问不了。
- 样式内容：仅 8 个图层（背景、海岸线、国界填充/边界、经纬线、国名标注等），没有道路、POI、行政区；源是境外第三方瓦片，且样式里带自建国界多边形，国界画法未经国内标准核实。
- 结论：不加入可选底图。速度不构成接入理由，合规与内容都不满足；项目继续用高德/天地图的合规瓦片，空白底板作为无 Key 时的兜底。
