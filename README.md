# PrivateBet Agent

隐私化 Polymarket AI 竞猜代理 — Telegram Bot + ZAMA FHE + AI 推荐引擎

## 项目结构

```
privatebet-agent/
├── packages/
│   ├── bot/              # Telegram Bot 服务 (grammY)
│   ├── ai-engine/        # AI 推荐引擎 (LLM 分析)
│   ├── wallet-service/   # MPC 钱包托管服务
│   ├── privacy-layer/    # ZAMA FHE 隐私层集成
│   ├── polymarket-client/# Polymarket CLOB API 封装
│   └── shared/           # 共享类型与工具
├── docker-compose.yml    # PostgreSQL + Redis
└── .env.example          # 环境变量模板
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量
cp .env.example .env
# 编辑 .env 填入实际值

# 3. 启动基础设施
docker compose up -d

# 4. 构建
pnpm build

# 5. 开发模式
pnpm dev
```

## 常用命令

| 命令             | 说明                |
| ---------------- | ------------------- |
| `pnpm build`     | 构建所有 package    |
| `pnpm dev`       | 监听模式开发        |
| `pnpm lint`      | ESLint 检查         |
| `pnpm format`    | Prettier 格式化     |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm clean`     | 清理构建产物        |

## 技术栈

- **Runtime:** Node.js 20+ / TypeScript 5.7 (strict)
- **Bot 框架:** grammY
- **数据库:** PostgreSQL 15 + Redis 7
- **包管理:** pnpm workspace
- **LLM:** Claude Opus / GPT-4o-mini
- **链上交互:** Polymarket CLOB SDK + ZAMA fhevmjs

## 开发阶段

- **Phase 1:** 技术验证 (2-3 周) — 当前
- **Phase 2:** MVP 开发 (4-6 周)
- **Phase 3:** 优化与扩展
