# 产品需求文档 (PRD)：隐私化 Polymarket AI 竞猜代理

## 文档信息

| 项目     | 内容                    |
| -------- | ----------------------- |
| 产品名称 | PrivateBet Agent (暂定) |
| 文档版本 | v1.0                    |
| 创建日期 | 2026-04-30              |
| 文档类型 | 产品需求文档 (MVP)      |

------

## 一、产品概述

### 1.1 产品定位

一个基于 Telegram Bot 的 AI 智能代理，每日筛选 Polymarket 上的热门竞猜盘口，结合市场信息为用户提供下注推荐，并通过 ZAMA 的全同态加密 (FHE) 技术实现资金链路的隐私化处理，让用户的下注行为与其链上身份解耦。

### 1.2 目标用户

- 关注预测市场但担忧链上隐私暴露的加密用户
- 希望通过 AI 辅助决策的 Polymarket 玩家
- 对隐私 DeFi（PriFi）感兴趣的早期采用者
- 高净值用户（不希望仓位被链上追踪/抢跑）

### 1.3 核心价值主张

1. **AI 驱动**：每日推送 AI 筛选与分析过的高价值盘口
2. **隐私保护**：通过 ZAMA 隐藏资金来源与下注地址的关联
3. **极简体验**：在 Telegram 内完成全部操作，无需打开 Polymarket 网站
4. **代理执行**：Agent 自主管理钱包，实现一键下单

### 1.4 核心问题与重要前提

> ⚠️ **技术可行性提示**：Polymarket 部署在 Polygon 上，使用 USDC.e 结算，并通过中央 CLOB 撮合（订单需 EIP-712 签名）。ZAMA fhEVM 当前主要部署在以太坊 L1 测试网与自身网络上。**两条链之间的 FHE 资产流转需要桥 + Relayer 中继**。本 PRD 在第 6 章详述资金路径设计，技术方需在 PoC 阶段重点验证。

------

## 二、产品架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                      用户 (Telegram)                          │
└────────────────────────────┬─────────────────────────────────┘
                             │
                  ┌──────────▼──────────┐
                  │   Telegram Bot      │  ← 用户交互层
                  │   (Node.js / Py)    │
                  └──────────┬──────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐   ┌─────────▼─────────┐  ┌──────▼────────┐
│  AI Agent    │   │  Wallet Service   │  │ Privacy Layer │
│ (LLM+市场分析)│  │  (MPC/KMS 托管)    │  │  (ZAMA FHE)   │
└───────┬──────┘   └─────────┬─────────┘  └──────┬────────┘
        │                    │                    │
┌───────▼──────────────┐     │       ┌────────────▼─────────┐
│ Polymarket Data API  │     │       │ Cross-chain Bridge   │
│ (Gamma/CLOB)         │     │       │ (Polygon ↔ ZAMA)     │
└──────────────────────┘     │       └────────────┬─────────┘
                             │                    │
                  ┌──────────▼────────────────────▼─────────┐
                  │           链上执行层                      │
                  │  Polymarket(Polygon) + ZAMA(fhEVM)      │
                  └──────────────────────────────────────────┘
```

------

## 三、核心功能模块

### 3.1 模块一：Telegram Bot 交互层

**功能要求**：

1. **用户注册与钱包绑定**
   - `/start`：欢迎语 + 引导
   - `/create_wallet`：为用户生成专属代理钱包（一个 Polygon 地址 + 一个 ZAMA 地址）
   - `/deposit`：展示充值地址与二维码（用户从外部 CEX/钱包打 USDC 进入存款地址）
   - `/balance`：查询余额（明文余额 + 加密余额分别展示）
2. **每日推荐推送**
   - 定时任务：每天固定时间（默认 UTC 02:00）推送 3-5 个推荐盘口
   - 推送格式：盘口标题 / 当前赔率 / AI 推荐方向 / 置信度 / 推荐仓位 / "立即下注"按钮
3. **下注交互**
   - 内联按钮：选择 YES/NO + 金额（预设 10 / 50 / 100 / 自定义 USDC）
   - 二次确认：展示费用明细（gas + 桥费 + ZAMA Relayer 费）
   - 状态推送：下单进入哪个阶段（隐私混淆中 / 桥接中 / 已挂单 / 已成交）
4. **持仓与历史**
   - `/positions`：当前持仓列表
   - `/history`：历史下注记录
   - `/withdraw`：提现至外部地址（同样走隐私通道）
5. **辅助功能**
   - `/settings`：设置推送时间、风险偏好、自动下单阈值
   - `/help`：使用说明

### 3.2 模块二：AI Agent（推荐引擎）

**职责**：每日抓取 Polymarket 数据 → 分析 → 输出推荐

**输入数据源**：

1. **Polymarket Gamma API**：获取活跃市场列表、成交量、流动性、当前价格
2. **Polymarket CLOB API**：获取订单簿深度
3. **市场新闻信息**：通过新闻 API（如 NewsAPI / Perplexity API / Tavily）获取盘口相关新闻
4. **可选增强**：Twitter/X API 抓取关键意见领袖观点

**筛选逻辑（MVP 版本）**：

- 筛选条件：24h 成交量 > $50,000，距离结算 > 24h，流动性 > $10,000
- 排序：按"成交量 × 价格波动率"综合打分

**LLM 分析任务**：

- 模型选择：Claude Opus 4.7 或 GPT-4 级别模型
- Prompt 任务：
  1. 阅读盘口描述与近期新闻
  2. 评估当前市场价格 vs 实际概率的偏离
  3. 输出：推荐方向 (YES/NO) / 置信度 (0-100) / 推理摘要 (≤100 字) / 建议仓位比例 (0-5% of balance)

**输出示例**：

```json
{
  "market_id": "0x...",
  "title": "Will Fed cut rates in May 2026?",
  "current_yes_price": 0.62,
  "recommendation": "NO",
  "confidence": 72,
  "reasoning": "近三日 CPI 数据高于预期，鲍威尔讲话偏鹰，市场定价偏乐观",
  "suggested_size_pct": 2.5
}
```

> ⚠️ **合规与免责**：所有推荐必须明确标注"AI 辅助分析，非投资建议"。

### 3.3 模块三：钱包托管服务

**核心要求**：Agent 需要代用户签名交易，因此需要安全的密钥管理方案。

**MVP 推荐方案**：

- 使用 **Privy / Turnkey / Web3Auth** 等 MPC 钱包服务，每个 TG 用户对应一个 sub-wallet
- Bot 后端不直接持有私钥，而是通过 MPC 服务的 API 触发签名
- 用户 Telegram ID 作为身份标识，绑定 MPC 服务的 user identity

**未来升级**：可考虑 Account Abstraction (ERC-4337) + Session Keys，让用户授权特定额度由 Agent 自动操作

### 3.4 模块四：隐私层（ZAMA 集成）

**目标**：让"用户充值地址" → "Polymarket 下单地址"之间的链上关联被切断。

**技术原理**：

- ZAMA 的 fhEVM 支持 **加密 ERC20**（如 EncryptedUSDC / cUSDC），余额本身在链上是密文
- 多笔加密转账无法在链上区分来源，达到资金混淆效果
- 提现时再解密为明文 ERC20

**本产品中的资金路径见下章详述。**

### 3.5 模块五：Polymarket 集成层

**API 调用**：

1. 通过 Polymarket CLOB Client SDK（官方提供 Python / TS 版本）
2. 关键操作：
   - `createOrder`：创建限价/市价订单（需 EIP-712 签名）
   - `cancelOrder`：撤单
   - `getMarkets`：获取市场列表
   - `getPositions`：查询持仓
3. 订单签名：使用代理钱包的 Polygon 私钥签名

------

## 四、用户流程详述

### 4.1 首次使用流程

```
1. 用户在 TG 搜索并启动 Bot
2. /start → Bot 欢迎 + 隐私协议
3. /create_wallet → 后端调用 MPC 服务生成钱包对
4. /deposit → Bot 返回 Polygon USDC 充值地址 + 二维码
5. 用户从交易所提币 USDC → 充值地址
6. Bot 监听到入账 → 推送通知"已入账 $XXX，是否启动隐私化？"
7. 用户确认 → 启动隐私化流程（详见第 6 章）
8. 隐私化完成 → 进入待下单状态
```

### 4.2 每日推荐与下注流程

```
1. UTC 02:00 → Bot 推送 3-5 个推荐盘口
2. 用户点击"立即下注"按钮
3. Bot 弹出仓位选择（10/50/100/自定义）
4. 用户确认 → 二次确认页面（含费用明细）
5. 用户最终确认 → 进入执行流程：
   a) 从 ZAMA 加密余额中解密对应金额
   b) 通过桥转回 Polygon（到一个新派生地址 sub-wallet B）
   c) sub-wallet B 在 Polymarket 下单
6. 全程通过 Bot 推送状态更新
7. 成交后推送结果通知
```

### 4.3 提现流程

```
1. 用户 /withdraw → 输入金额 + 外部地址
2. 关闭对应持仓 → USDC 回到 sub-wallet B
3. sub-wallet B → 桥到 ZAMA → 加密
4. 加密余额内部混淆若干轮
5. 解密到用户指定外部地址（与原充值地址无关联）
```

------

## 五、AI Agent 详细设计

### 5.1 调度模块

- 定时器：基于 cron，每日 02:00 UTC 触发全量分析
- 触发器：用户主动 `/refresh` 也可触发单次分析

### 5.2 分析 Pipeline

```
[Step 1] 拉取 Polymarket 全量活跃市场 (~ 数百个)
  ↓
[Step 2] 过滤：成交量、流动性、剩余时间
  ↓ (输出 Top 30)
[Step 3] 对每个市场抓取关联新闻 (3-5 条最新)
  ↓
[Step 4] 输入 LLM 进行分析（并行调用，控制并发数）
  ↓
[Step 5] 收集 LLM 输出，按置信度 × 预期收益排序
  ↓
[Step 6] 取 Top 5 推送给所有订阅用户
  ↓
[Step 7] 结果存数据库（用于后续胜率统计）
```

### 5.3 LLM Prompt 模板（示例）

```
你是一名预测市场分析师。请分析以下 Polymarket 盘口：

【市场标题】{title}
【市场描述】{description}
【结算时间】{end_date}
【当前 YES 价格】{yes_price}
【24h 成交量】{volume_24h}

【近期相关新闻】
{news_articles}

请输出 JSON：
{
  "recommendation": "YES" | "NO" | "SKIP",
  "confidence": 0-100,
  "reasoning": "不超过 100 字的推理",
  "suggested_size_pct": 0-5,
  "key_risks": ["风险1", "风险2"]
}

仅当置信度 ≥ 65 时给出 YES/NO，否则返回 SKIP。
```

------

## 六、隐私层详细设计 (ZAMA 集成) 🔑

> 这是本产品技术上最复杂的部分，需要在 PoC 阶段优先验证。

### 6.1 资金流转路径

**充值阶段**：

```
[用户外部地址]
      ↓ USDC (Polygon)
[Sub-Wallet A] (Polygon 充值地址，与 TG 用户绑定)
      ↓ 通过桥 (如 LayerZero / Hyperlane / 自建中继)
[ZAMA fhEVM 上的对应地址]
      ↓ 调用加密合约：deposit() 转为 cUSDC (encrypted)
[加密余额池]
      ↓ 内部多次加密转账（混淆轮）
[最终加密余额，归属一个新派生地址 X]
```

**下注阶段**：

```
[加密余额 X]
      ↓ decrypt + bridge back to Polygon
[Sub-Wallet B] (新地址，与 Sub-Wallet A 无链上关联)
      ↓ Polymarket CLOB 下单（EIP-712 签名）
[订单成交 → 持仓]
```

**提现阶段**：基本是充值的逆向流程，最终到达用户指定的新地址。

### 6.2 隐私强度说明（务必如实告知用户）

- **能做到**：切断"充值地址 ↔ 下单地址"的直接链上关联

- 不能做到

  ：

  - 完全无法被时间分析攻击（金额+时间窗口仍可能关联）
  - 防止 Polymarket 平台本身的 KYC 数据收集
  - 防止 Telegram / 后端服务的元数据收集

- 加强措施

  ：

  - 加密余额池中混入其他用户资金（增大匿名集）
  - 引入随机延迟（数小时至数天）
  - 金额分片处理（不等额拆分）

### 6.3 桥接方案选择

| 方案                     | 优点         | 缺点                          |
| ------------------------ | ------------ | ----------------------------- |
| LayerZero / Hyperlane    | 成熟、快速   | 需依赖第三方，成本较高        |
| 自建 Relayer + 锁定/铸造 | 可控、低成本 | 开发量大，需自建流动性池      |
| ZAMA 官方桥（若有）      | 原生支持     | 当前不一定具备到 Polygon 的桥 |

**MVP 建议**：先用第三方桥跑通，后续根据成本与体验切换。

### 6.4 替代方案（若 ZAMA 路径过重）

如果 ZAMA + 桥的路径在 PoC 阶段被证明过于复杂或慢，可考虑降级方案：

- **方案 B**：使用 Railgun / Aztec 等已有的隐私池协议（同样在 EVM 上）
- **方案 C**：使用一组预派生的中转地址 + 时间随机化，弱隐私但实现简单

无论选哪个方案，对外宣传都需要严格匹配实际隐私强度。

------

## 七、技术栈建议

| 层级           | 推荐技术                                        |
| -------------- | ----------------------------------------------- |
| Bot 框架       | Node.js + grammY / Python + python-telegram-bot |
| 后端服务       | Node.js (NestJS) 或 Python (FastAPI)            |
| 数据库         | PostgreSQL (业务数据) + Redis (缓存与队列)      |
| 任务队列       | BullMQ / Celery                                 |
| 钱包托管       | Privy / Turnkey (推荐 Privy，TG 集成更友好)     |
| LLM            | Claude Opus 4.7 (Anthropic API)                 |
| Polymarket SDK | @polymarket/clob-client (TS)                    |
| ZAMA           | fhevmjs (TS SDK) + fhEVM Solidity 合约          |
| 桥             | LayerZero V2 / Hyperlane                        |
| 部署           | Docker + AWS/GCP，Bot 服务无状态化              |
| 监控           | Sentry + Grafana + 自定义资金对账脚本           |

------

## 八、数据模型（核心表）

```
users
  - tg_user_id (PK)
  - polygon_deposit_address
  - zama_address
  - mpc_user_id
  - created_at
  - settings (jsonb)

wallets_subaccounts
  - id
  - user_id (FK)
  - address
  - chain
  - purpose (deposit / privacy_pool / betting)
  - created_at

deposits
  - id
  - user_id
  - tx_hash
  - amount
  - status (received / privatizing / privatized)

bets
  - id
  - user_id
  - market_id
  - side (YES/NO)
  - amount
  - entry_price
  - status (pending / active / settled)
  - polymarket_order_id

recommendations
  - id
  - market_id
  - generated_at
  - recommendation
  - confidence
  - reasoning
  - llm_model_version

privacy_operations
  - id
  - user_id
  - type (deposit_to_zama / withdraw_from_zama)
  - source_addr
  - dest_addr
  - amount
  - tx_hashes (jsonb)
  - status
```

------

## 九、MVP 范围与里程碑

### Phase 1：技术验证 (2-3 周)

- [ ] ZAMA fhEVM 合约部署 + 加密 USDC 转账打通
- [ ] Polygon ↔ ZAMA 桥的 PoC（小额跑通一次完整路径）
- [ ] Polymarket CLOB API 下单跑通
- [ ] **里程碑**：能用脚本完成"USDC → ZAMA → 回 Polygon → 下注"全链路

### Phase 2：MVP 开发 (4-6 周)

- [ ] Telegram Bot 基础交互
- [ ] MPC 钱包集成
- [ ] AI 推荐引擎
- [ ] 充值/下注/提现完整流程
- [ ] 内测 10-20 个用户

### Phase 3：优化与扩展 (持续)

- [ ] 推荐胜率统计与展示
- [ ] 自动下注（用户授权额度内）
- [ ] 多语言支持
- [ ] 推荐分析的 Web Dashboard

------

## 十、风险与开放问题

### 10.1 技术风险

1. **ZAMA → Polygon 桥的成熟度**：当前 ZAMA 生态尚在早期，跨链方案需 PoC 验证
2. **Gas 与 Relayer 成本**：FHE 操作 + 跨链 + 下单的累计成本可能高于小额下注收益，建议设最低下注门槛（如 $50）
3. **延迟**：完整隐私化流程可能需要数小时，需在 UI 上明确告知

### 10.2 合规风险

1. **托管钱包属性**：MPC 钱包是否构成"为客户托管资金"，可能触发不同司法辖区的金融牌照要求
2. **隐私服务的法律灰区**：部分国家/地区对混币服务有严格限制（如 Tornado Cash 案例），需法务咨询
3. **Polymarket 地域限制**：Polymarket 本身禁止美国用户，Bot 需做相应准入检查

### 10.3 产品开放问题（需决策）

1. 是否收取手续费？如何收取（按量 / 订阅）？
2. 是否做多用户共享匿名集（强隐私但运营复杂）vs 单用户独立通道（弱隐私但简单）？
3. AI 推荐错误造成用户损失，免责条款如何设计？
4. 是否支持非 Polymarket 的其他预测市场（如 Limitless）？

------

## 十一、成功指标 (KPI)

- **激活**：30 天内绑定钱包并完成首次充值的用户数
- **留存**：周活跃用户 / 月活跃用户
- **核心转化**：每周至少完成一次下注的用户比例
- **AI 质量**：推荐胜率 > 55%（vs 市场隐含概率的基线）
- **隐私指标**：成功隔离的资金路径数量（充值地址与下注地址无可观测关联）
- **资金规模**：管理资金总量 (TVL)

------

## 附录：MVP 之前必做的关键验证清单

在投入完整开发前，强烈建议做以下技术验证（顺序重要）：

1. ✅ 确认 ZAMA fhEVM 当前可用网络（主网/测试网状态）
2. ✅ 验证 Polygon ↔ ZAMA 是否有现成桥，否则需自建工作量评估
3. ✅ 跑通最小可行链路：1 USDC 完整走完 Polygon → ZAMA → Polygon → Polymarket 下单
4. ✅ 评估单笔操作总成本（gas + 桥费），确定最低下注门槛
5. ✅ 评估单笔操作总耗时，确定 UX 设计中的预期等待时间表述
6. ✅ Polymarket 对于 API 频繁下单的地址是否有限频或风控

------

如需进一步拆解某个模块（例如详细的 Bot 命令交互稿、ZAMA 合约接口设计、AI Prompt 工程的完整版本），我可以单独输出对应文档。