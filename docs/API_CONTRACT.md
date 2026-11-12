# API 与公共类型契约 v1

本文定义应用自己的接口，不是天地图/高德上游接口。真实上游路径、字段和配额由 P0 核实后封装在适配器；不能把下文应用接口直接转发为供应商 URL。

**实现状态（2026-11-12）**：本文同时保留已实现接口与规划接口。实际已注册路由以 [ARCHITECTURE.md](ARCHITECTURE.md) §4.2 和运行中的 OpenAPI 为准；与本文有差异的部分在 [DELIVERY.md](DELIVERY.md) 记录。当前明确**未实现**的契约项包括：找回密码/重置密码、逆地理编码、行政区、标注（Annotation）、附件/资产、Dataset 导入与瓦片、离线清单、PWA 离线、分享页地图图层。已实现接口也可能有字段裁剪，不能把本文当作“全部已联调”的证明。

## 1. 通用约定

- 前缀 /api/v1；JSON UTF-8、snake_case；文件上传 multipart/form-data；下载直接返回文件流。
- UUID 为字符串。坐标 [经度,纬度]，标准几何遵循 RFC7946。距离米、持续秒、金额整数分。
- date 为 YYYY-MM-DD；local_time 为 HH:mm；时刻为带时区的 ISO8601，服务端规范输出 UTC Z；tz 单独保存 IANA 名称。
- 成功单对象直接返回模型；分页为 {items,next_cursor}；cursor 不透明，默认20、最大50。
- 资源ID必须按当前用户/分享上下文检查；不存在和无权访问统一404，避免枚举。
- 所有行程内容写接口携带 If-Match: "<revision>"，缺失428，版本冲突409。创建行程、纯查询、上传私有资产、建任务和撤销分享不需要内容版本前置条件；引用行程创建任务仍必须验证 input_revision。
- 内容写成功返回 {trip_id,revision,resource} 和新 ETag；DELETE返回 {trip_id,revision,deleted_id}，不使用无版本信息的204。
- 所有带会话的状态修改验证 X-CSRF-Token；浏览器同域Cookie会话。登录/注册等未认证接口要求合法Origin并使用其专用限流。
- 有费用的纯查询使用POST；provider不得由客户端传URL，只可选 tianditu/amap/auto/both 中该接口允许的值。
- 私有API、供应商查询、分享和下载响应 Cache-Control: no-store；离线下载是经策略筛选的显式独立流程。

### 错误结构

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "行程已更新，请重新加载后合并修改。",
    "request_id": "example-request-id",
    "details": {"expected_revision": 12, "current_revision": 13}
  }
}
```

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | 业务请求格式无效 |
| 401 | AUTH_REQUIRED / SESSION_EXPIRED | 未登录或会话失效 |
| 403 | CSRF_FAILED / EMAIL_UNVERIFIED | 会话请求验证失败/邮箱尚未验证 |
| 404 | NOT_FOUND | 不存在或不允许访问 |
| 409 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / RESOURCE_IN_USE | 版本/幂等键冲突、资源仍被引用 |
| 413 | FILE_TOO_LARGE | 文件/解压/图片像素/要素超限 |
| 422 | VALIDATION_ERROR / SOURCE_USE_RESTRICTED / CRS_REQUIRED / CRS_UNSUPPORTED / UNSUPPORTED_CAPABILITY / OPTIMIZATION_LIMIT | 字段、数据用途或能力不满足 |
| 428 | REVISION_REQUIRED | 缺少If-Match |
| 429 | RATE_LIMITED / PROVIDER_QUOTA_EXCEEDED | 应用或供应商限额，提供适用的Retry-After |
| 502 | PROVIDER_ERROR | 上游返回不可用/无法解析的结果 |
| 503 | PROVIDER_UNAVAILABLE / PROVIDER_NOT_CONFIGURED | 暂时不可用或未配置 |
| 504 | PROVIDER_TIMEOUT | 上游超时 |

异步求解不可行、GIS错误等写入Job的error_code，不把业务失败伪装成HTTP500。取消为cancelled，非failed。

## 2. 公共模型

### 2.1 Position、来源与能力

Position = {coordinates:[number,number], crs:"WGS84"|"GCJ02"|"CGCS2000", approximate:boolean}。标准业务几何只能WGS84；原始数据用source_location/source_crs，不把GCJ02序列直接装进RFC7946 geometry。

Source = {provider:"user"|"import"|"tianditu"|"amap", retrieved_at:null|datetime, license_ref:null|string, source_crs:null|string, transform_method:null|string, approximate:boolean}。

UsePolicy每项为 {status:"allowed"|"denied"|"unknown", allowed_fields:string[], evidence_ref:null|string, expires_at:null|datetime}；用途有display_on_custom_map、persist、share、export、offline、retain_reference、compute。来源政策来自服务端配置，客户端提交的policy不可信且不接收。

Capability = {provider, capability, configured, verified, status, input_crs, output_crs, supports_departure_time, supports_batch, policy, last_verified_at, reason}；不返回Key、真实剩余额度或内部上游URL。未配置为配置缺失，未实测为未验证，不能统一写成“不支持”。

外部查询结果为临时模型，包含id（本次响应局部ID）、provider、name、category、address、source_location、geometry、source、policy、selection_token（可空）。geometry为空时前端不把原坐标误画到地图。

selection_token为短期签名选择凭证，绑定user/provider/允许的上游引用/查询用途/过期时间，10分钟失效，仅在结果被选中时使用。它不进入历史、日志或离线包；保存时服务端重新核实策略，必要时重新查询。无持久化权的数据不得因签名凭证而获得持久化权。上游无可用详情ID时适配器重查原查询并匹配候选；匹配不唯一时要求重新选择，不猜测。

### 2.2 Trip 与内容

TripSummary = id、title、start_date、end_date、timezone、currency、revision、updated_at、cover_asset_id可空。

TripDetail = TripSummary + budget_minor可空、preferences、days[]、places[]、stops[]、annotations[]、layers[]、route_legs[]、warnings[]。由服务端按允许字段输出，历史与分享使用各自的投影模型。当前实现的 TripDetail 含 days/places/stops/route_legs/map_layers/warnings，尚未实现 annotations；历史与分享使用 GuideSnapshot，不直接返回 TripDetail。

Day = id、date、start_local_time（默认09:00）、end_local_time（默认20:00）、start_place_id/end_place_id可空、notes。

Stop = id、trip_id、day_id可空、place_id可空、kind（attraction/meal/lodging/transport/free）、title、position、duration_seconds（默认3600）、priority（required/preferred/optional）、locked_day、locked_position、fixed_start可空、time_windows[]、cost_minor可空、notes、asset_ids[]、source。

time_windows = [{date, start_local_time, end_local_time}]；跨午夜由API规范化成按日期区间。fixed_start为带offset时刻，必须落在对应日期时区；本地时刻遇到DST歧义需显式offset，不猜测。transport允许单独的fixed_end及mode/manual_reference；到达时刻不得早于出发。

Place = id、trip_id、name、category、geometry（Point或null）、navigation_geometry（Point或null）、user_attributes、asset_ids[]、source_fields、source、policy。navigation_geometry为明确选择的导航入口，路由端点优先用它，原geometry仍供景点展示。用户输入字段长度：名称1–120、备注≤10000、标签≤20个且每个≤30；自定义属性JSON≤16KB且不接受脚本/原型污染键。

Annotation = id、geometry、title、attributes、style、asset_ids[]。style只允许颜色、线宽、透明度、图标枚举和标签开关，不接受任意MapLibre表达式或HTML。地点/事项/标注创建或修改时可提交asset_ids完整有序列表，服务端验证同一行程归属和用途，事务更新asset_links并进入快照。

RouteLeg = id、from_ref、to_ref、mode、provider、status（ready/stale/unknown/unreachable）、geometry可空、distance_m可空、duration_seconds可空、departure_at可空、retrieved_at可空、source、policy。status=ready也不代表具备存储或导出全部字段的权利。

## 3. 账号与配置

| 方法 路径 | 请求 | 响应/规则 |
| --- | --- | --- |
| GET /health/live | 无 | {status}；无私有详情 |
| GET /health/ready | 无 | {status}；可供探针，未就绪503 |
| GET /config/public | 无 | 注册模式、功能标志、公开底图配置、应用上限、受域名限制的公开浏览器凭据（如采用此方式） |
| GET /providers/capabilities | 登录 | 当前用户可用能力与状态，不触发批量实测 |
| POST /auth/register | email,password,display_name,invite_token可空 | 202通用提示；生产验证邮箱 |
| POST /auth/verify-email | token | 完成一次性验证 |
| POST /auth/login | email,password | Set-Cookie；{user,csrf_token} |
| GET /auth/session | Cookie | {user,csrf_token}，供刷新恢复状态 |
| POST /auth/logout | Cookie+CSRF | 撤销当前会话 |
| POST /auth/forgot-password | email | 202通用提示，避免账号枚举 |
| POST /auth/reset-password | token,new_password | 撤销原会话；令牌一次性 |
| PATCH /auth/password | current_password,new_password | 轮换当前会话并撤销其他会话 |
| GET /auth/sessions | 登录 | 本人会话列表，去掉token_hash |
| DELETE /auth/sessions/{session_id} | CSRF | 撤销本人指定会话 |
| PATCH /users/me | display_name | 个人资料 |

邀请注册由部署脚本生成邀请，不为首版额外开发管理后台。改邮箱、第三方登录不在首版范围。

## 4. 行程与空间编辑

以下{id}表示trip_id。除创建/查询外，内容写接口均使用If-Match。

| 方法 路径 | 输入及行为 |
| --- | --- |
| GET /trips | cursor,limit,q；本人行程摘要 |
| POST /trips | title,start_date,end_date,timezone,currency,budget_minor；创建日期和revision=1 |
| GET /trips/{id} | 返回TripDetail和ETag |
| PATCH /trips/{id} | 标题、偏好、预算；日期变更使用下述专用接口 |
| DELETE /trips/{id} | 软删除、撤销分享、使成果不可再下载 |
| POST /trips/{id}/clone | source_revision可空；生成新行程 |
| POST /trips/{id}/date-change-preview | start_date,end_date；纯预览受影响事项 |
| POST /trips/{id}/change-dates | start_date,end_date,overflow:"to_candidates"；缩短日期时越界事项进入候选池 |
| PATCH /trips/{id}/days/{day_id} | 开始/结束时间、起终点place_id、备注 |
| POST /trips/{id}/places | 自有{name,category,geometry,user_attributes}，或外部{selection_token,user_overrides}；服务端检查来源 |
| PATCH /trips/{id}/places/{place_id} | 更新自有字段或明确编辑的字段，保留未改来源 |
| DELETE /trips/{id}/places/{place_id} | 有当前事项/起终点引用返回409；可显式detach=true解除引用 |
| POST /trips/{id}/stops | Stop可写字段；day_id=null进入候选池 |
| PATCH /trips/{id}/stops/{stop_id} | 事项字段，移动/重排用专用接口 |
| DELETE /trips/{id}/stops/{stop_id} | 删除后重排并使相关路线stale |
| POST /trips/{id}/reorder-stops | containers:[{day_id,stop_ids}]；包含所有受影响容器完整序列，事务内校验不重不漏 |
| POST /trips/{id}/annotations | geometry,title,attributes,style |
| PATCH /trips/{id}/annotations/{annotation_id} | 几何或属性变更 |
| DELETE /trips/{id}/annotations/{annotation_id} | 删除自有标注 |
| GET /trips/{id}/timeline | day_id；用当前已存允许数据计算，不触发外部批量请求 |
| GET /trips/{id}/revisions | cursor,limit；版本摘要 |
| GET /trips/{id}/revisions/{revision} | 当前策略过滤后的只读快照，返回redactions |
| POST /trips/{id}/restore | source_revision；恢复为新revision，必要时返回政策限制的字段问题 |

缩短日期保留仍存在日期对应事项，不整体平移日期；对越界固定预约清除fixed_start并记录警告，保留到备注供用户重新安排。更换时区只改变解释日程的时区，固定UTC预约不隐式改成另一个真实时刻，预览并明确冲突。

### 创建行程示例

```json
{
  "title": "杭州三日游",
  "start_date": "2026-12-01",
  "end_date": "2026-12-03",
  "timezone": "Asia/Shanghai",
  "currency": "CNY",
  "budget_minor": 300000
}
```

### 跨天移动示例

POST /trips/{id}/reorder-stops，If-Match: "12"：

```json
{
  "containers": [
    {"day_id": "11111111-1111-4111-8111-111111111111", "stop_ids": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]},
    {"day_id": "22222222-2222-4222-8222-222222222222", "stop_ids": ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]}
  ]
}
```

上述ID仅为示例。仅允许移动请求前就属于这两个容器的事项；跨行程ID、重复/缺失事项或违反锁定规则均返回422；用户主动解锁后才可移动锁定事项。

## 5. 地图查询与路径

| 方法 路径 | 输入 | 输出/约束 |
| --- | --- | --- |
| POST /maps/suggest | provider,q,city_code可空 | 临时建议；both不支持时返回能力错误 |
| POST /maps/search | provider,q,category可空,city_code可空,center可空,radius_m可空,bbox可空,page,limit | 按来源分组的临时结果；nearby与bbox互斥 |
| POST /maps/details | selection_token | 临时详情及来源，不盲信客户端原始字段 |
| POST /maps/geocode | provider,address,city_code可空 | 位置候选及来源 |
| POST /maps/reverse-geocode | provider,location | 地址候选；输入CRS显式声明 |
| POST /maps/districts | provider,q,level | 行政区，字段/边界按实际能力 |
| POST /maps/weather | provider,city_code | 天气类型、发布时间、有效时段；不编造超出预报期的数据 |
| POST /trips/{id}/routes/query | from_ref,to_ref,mode,provider,departure_at可空,city_code可空 | 临时RouteCandidate[]，不修改trip |
| PUT /trips/{id}/route-settings | legs:[{from_ref,to_ref,mode,provider,departure_at,selected_option,selection_token可空}] | 用户偏好及允许保存的结果原子写入；If-Match |

from_ref/to_ref为当前行程place或stop引用；端点跨账号/跨行程404。端点取navigation_geometry优先，否则geometry，响应给出实际采用位置及无入口信息提示。公交的 citycode 由服务端按起点坐标自动识别（逆地理），识别不到才要求用户在 city_code 填写。公交可传 strategy（0 推荐/2 最少换乘/5 不乘地铁/7 地铁优先/8 时间短）区分地铁与普通公交；公交几何从各分段 buslines/walking 的 polyline 拼接，不是整体 polyline（后者常为空）。mode=driving/walking/bicycling/electrobike/transit；骑行与电动车走高德路径规划 2.0 的 v5/direction/bicycling、v5/direction/electrobike，duration 取 paths[0].duration，geometry 由 steps[].polyline 拼出。上游未返回 duration 时返回 status=partial 并提示手工录入，不用距离除以固定速度推算。

RouteCandidate包含distance/duration/geometry/steps（允许时）、source、policy及选择凭证。选择凭证绑定端点、模式、候选编号、查询时刻和输入hash。保存时只保存用户交通选择及获准字段；当上游数据禁止保存，响应包含redactions，持久化RouteLeg为unknown，当前页面可在允许用途内继续显示临时结果。刷新后重新在线查询，不在浏览器持久化补洞。

HTTP成功但上游status为失败必须映射应用错误，不能显示为“没有路线”；空结果、不可达、超额分别表达。禁止把高德JSON字段直接暴露为应用公共类型。

both搜索允许一源失败，响应包含results_by_provider和warnings；两源均失败返回适用的502/503/429。显式选中的来源不可静默替换，auto响应必须返回actual_provider。

## 6. 优化与任务

| 方法 路径 | 输入 | 输出 |
| --- | --- | --- |
| POST /trips/{id}/optimization-jobs | 下例；Idempotency-Key | 202 Job，校验input_revision |
| GET /jobs | 本人、cursor、limit、kind/status可选 | Job摘要 |
| GET /jobs/{job_id} | 本人 | 状态、进度、阶段及脱敏错误 |
| GET /jobs/{job_id}/result | 本人、成功状态 | 经策略检查的结果/成果引用，不返回原始上游矩阵 |
| POST /jobs/{job_id}/cancel | CSRF | queued直接取消，running标记cancel_requested |
| POST /jobs/{job_id}/retry | CSRF | 已失败任务新建job，重新验证输入/配额，不原地覆盖历史 |
| POST /trips/{id}/apply-optimization | job_id；If-Match | 校验任务/归属/revision/hash，事务应用 |

```json
{
  "input_revision": 12,
  "scope": "day",
  "day_ids": ["11111111-1111-4111-8111-111111111111"],
  "mode": "driving",
  "provider": "auto"
}
```

scope=day要求一个day_id，trip要求1–7个日期且按应用节点上限校验；仅driving/walking。规划约束取已保存行程，不接受客户端覆盖任务时间上限/请求预算。

Job公共字段：id、kind、status、progress（0–100）、stage、input_revision可空、created_at、started_at可空、finished_at可空、error可空、cancel_requested；不含内部队列参数。

OptimizationResult：input_revision、input_hash、solver_status（feasible/time_limit/infeasible）、days[]、unassigned[]、conflicts[]、totals、assumptions、provider_summary。没有可行解时job为failed、error.code=NO_FEASIBLE_PLAN，并提供安全的约束诊断；达到时限但有可行解为succeeded/time_limit。

若建议保存需要的数据用途未获许可，返回SOURCE_USE_RESTRICTED或不提供可应用建议；不得把受限矩阵或路线塞进RQ默认result。业务结果只保存允许的建议序列和自有事项的安排。

## 7. 文件、GIS 数据与图层

| 方法 路径 | 输入 | 输出/约束 |
| --- | --- | --- |
| POST /assets | multipart file、purpose、trip_id可空 | 私有Asset；流式上传并校验上限 |
| GET /assets/{asset_id}/download | 归属/有效分享上下文 | 文件流；Content-Disposition安全文件名 |
| DELETE /assets/{asset_id} | 所有者、CSRF | 无引用才能物理清理，有引用409 |
| POST /trips/{id}/datasets | asset_id,kind,source_crs可空 | Dataset+202预检Job；检查input_revision，未改行程内容 |
| GET /trips/{id}/datasets/{dataset_id} | 本人 | 元数据、图层/字段候选、警告、状态 |
| POST /trips/{id}/datasets/{dataset_id}/import-jobs | input_revision、选中子图层、确认CRS、字段映射、许可说明 | 202导入Job，不自动加入行程图层 |
| POST /trips/{id}/layers | dataset_id或受控服务配置、name、style | If-Match；ready数据才能加入，layer引用固定dataset版本 |
| PATCH /trips/{id}/layers/{layer_id} | visible,opacity,z_order,style,is_terrain | If-Match；同时最多一个terrain |
| DELETE /trips/{id}/layers/{layer_id} | If-Match | 移除图层引用，保留被历史版本引用的数据 |
| DELETE /trips/{id}/datasets/{dataset_id} | CSRF | 无当前/历史/任务引用才能清理，否则409 |
| GET /trips/{id}/layers/{layer_id}/features | bbox,limit,cursor | WGS84要素及分页，不返回全表 |
| GET /trips/{id}/layers/{layer_id}/tilejson | 权限 | 瓦片模板，不包含服务端Key |
| GET /tiles/{layer_id}/{z}/{x}/{y}.{ext} | 权限或有效分享会话 | 对应MVT、raster或terrain；按类型限制ext |

Dataset.status=uploaded/inspecting/awaiting_confirmation/processing/ready/failed。预检只输出元数据和报告；确认导入成功后Dataset.ready，加入图层是独立事务，因此导入任务运行期间用户可继续编辑行程。导入Job的input_revision供来源记录，完成时不覆盖行程；加入图层用当前If-Match。

外部服务配置：type=xyz/tms/wmts/wms/mvt、url、layer_name、tile_matrix_set、source_layer及attribution按类型要求。服务端校验允许域名、协议和能力；凭据由受控配置引用，不接受导出到浏览器的服务端Key。未知CRS或瓦片矩阵返回422并给出预处理建议。

私有瓦片使用同域Cookie；公开分享只允许访问分享快照明确包含且允许分享的图层版本。不能因为layer_id存在就公开整个dataset。

### 已实现：专题图层 v1（点图层，2026-11）

上表的 dataset/瓦片链路尚未实现；当前已上线的是轻量点图层（MapLayer + MapLayerFeature），坐标一律 WGS84（POINT, 4326），随工作台 `TripDetail.map_layers` 输出。**分享页当前使用 GuideSnapshot，不包含地图图层**；快照也未写入 map_layers，因此历史/导出同样没有图层。这是已记录差异，不要按“分享页可见图层”理解。

| 方法 路径 | 输入 | 输出/约束 |
| --- | --- | --- |
| GET /trips/{trip_id}/layers | — | MapLayerOut[]（含 features）；我的=kind:mine，系统=kind:system |
| POST /trips/{trip_id}/layers | name、kind(mine/system)、category、icon、color | 201 新建图层；系统图层预设地铁站/公交站/酒店/景点/商场/饭店/公厕 |
| PATCH /trips/{trip_id}/layers/{layer_id} | name、visible、opacity(0–1) 可选 | 重命名、显隐或透明度 |
| DELETE /trips/{trip_id}/layers/{layer_id} | — | 204 删层并级联删要素；kind=system 时 422 拒绝（系统图层不允许删除） |
| POST /trips/{trip_id}/layers/{layer_id}/features | name、lon、lat(WGS84)、category、properties | 打点进图层 |
| DELETE /trips/{trip_id}/layers/{layer_id}/features/{feature_id} | — | 删单点 |
| POST /trips/{trip_id}/layers/{layer_id}/collect | lon、lat、radius_m(≤5000)、limit(≤40) | 按地图中心采周边 POI 入库（AMap place/around），按名称去重；无结果返回 EMPTY_RESULT |
| GET /trips/{trip_id}/layers/{layer_id}/export | — | FeatureCollection（GeoJSON）下载 |



## 8. 攻略、导出、离线与分享

| 方法 路径 | 输入 | 输出/规则 |
| --- | --- | --- |
| GET /trips/{id}/guide | revision可选 | GuideSnapshot预览、redactions、warnings |
| POST /trips/{id}/export-jobs | revision,format（md/md_zip/docx）,include_maps,include_attachments；Idempotency-Key | 202任务；当前策略检查 |
| GET /exports/{export_id}/download | 所有者 | 检查行程未删除、成果未过期和当前用途，返回文件流 |
| GET /trips/{id}/offline-manifest | revision | 可离线字段、允许资产ID和校验和，不是完整在线TripDetail |
| POST /trips/{id}/shares | revision,expires_in_days（1/7/30，默认7）,password可空,allow_clone（默认false） | 仅此次返回完整url/token，其后列表不返回token |
| GET /trips/{id}/shares | 所有者 | 分享摘要、创建时间、过期/撤销状态 |
| DELETE /trips/{id}/shares/{share_id} | 所有者、CSRF | 立即撤销，不要求内容If-Match |
| GET /shares/{token} | token | 无密码则只读快照；有密码返回requires_password，不泄露行程正文 |
| POST /shares/{token}/unlock | password | 短期分享访问Cookie（30分钟或分享剩余时长较短者） |
| GET /shares/{token}/assets/{asset_id} | 有效分享上下文 | 只读快照内允许的附件流 |
| GET /shares/{token}/tiles/{layer_id}/{z}/{x}/{y}.{ext} | 有效分享上下文 | 只读快照内允许的图层版本瓦片 |
| POST /shares/{token}/clone | 登录+CSRF，有效分享上下文 | allow_clone才允许，返回新trip |

分享密码尝试每token+IP每15分钟最多5次。撤销、过期、行程删除后返回404；浏览器页面清除相应已加载内容，不声称能删除用户已经下载到设备的副本。

GuideSnapshot：schema_version、trip_id、revision、generated_at、title、date_range、timezone、days[]、budget_summary、maps[]、attachments[]、sources[]、redactions[]。离线内容使用其offline用途投影，不保存在线查询凭证或无权离线字段。

include_maps=true但供应商静态图不可用时，优先生成自有地点示意图并明确标注。若地图是用户要求的必备内容且完全无法生成，任务明确失败，不悄悄输出空白文档。普通可省略附件被过滤时返回warnings和清单。

## 9. OpenAPI 与变更流程

实现时由Pydantic模型生成openapi.json，再使用openapi-typescript生成前端类型；前端生成文件只由脚本更新。CI检查生成结果与接口定义一致。

breaking change涉及持久化或既有客户端时，提供迁移并更新schema_version；Web首版默认/api/v1，在无线上用户之前可通过同步变更修订本契约，不维护平行接口。E1设备授权接口在Electron实施阶段单独补充并验收。
