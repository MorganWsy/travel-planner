# 文档索引

本目录保留 5 份正文文档和本索引。原先的 `DELIVERY.md`（交付差异与验证记录）与 `UPGRADE_ASSESSMENT.md`（技术栈升级评估）已合并进 `ARCHITECTURE.md`，不再单独维护，避免同一事实分散在多个文件里。

| 文档 | 作用 | 什么时候看 |
| --- | --- | --- |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 产品范围、P0–P5 阶段计划、目标架构和数据边界基线 | 判断“这个功能属于哪一期、原本怎么设计”时 |
| [API_CONTRACT.md](API_CONTRACT.md) | 公开接口、错误码、权限与公共类型契约 | 改后端路由、生成前端类型、联调接口时 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 分阶段验收标准、测试范围与出口条件 | 判断一个阶段是否真正完成时 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **当前仓库实际实现**：模块职责、核心业务流、交付差异、验证记录、版本与升级状态 | 第一次读代码、排查实现与方案差异、升级依赖时 |
| [PROVIDER_RESEARCH.md](PROVIDER_RESEARCH.md) | 高德/天地图等外部能力的事实、来源与验证状态 | 配置 Key、判断某个供应商能力是否真的可用时 |

## 建议阅读顺序

1. 先看 `ARCHITECTURE.md` 第 1–2 节，建立“模块化单体 + 同代码库任务处理器”的整体印象。
2. 再看 `IMPLEMENTATION_PLAN.md`，了解产品目标和阶段边界；不要把规划能力当成已实现能力。
3. 改接口前读 `API_CONTRACT.md`；判断能否交付时读 `ACCEPTANCE.md`。
4. 涉及地图 Key、瓦片、搜索或路线时，以 `PROVIDER_RESEARCH.md` 的“已验证/未验证”记录为准。

## 维护约定

- `ARCHITECTURE.md` 是实际实现的唯一汇总入口；交付差异、验证结果和升级记录都写在这里。
- 规划与验收文档保持“目标”和“实际”分离，不把未验证项改写成已通过。
- 外部能力必须保留来源、核实日期和验证状态；截图里有入口不等于生产接口可用。
- 新增文档前先判断能否并入现有 5 份正文，避免再次出现多份内容重叠的文档。