# Stage 11：支付宝沙箱接入与支付基础加固

## 1. 文档状态

- 状态：可实施
- 首期产品：支付宝电脑网站支付（`alipay.trade.page.pay`）
- 首期环境：支付宝沙箱；真实资金默认关闭
- 仓库：PayFlow monorepo
- 实施原则：保持 Stripe、PayPal 行为兼容；迁移只允许新增，不修改已发布迁移

本文既是 Stage 11 的设计说明，也是实现任务与验收清单。实现者应先阅读
`docs/architecture.md`、`docs/payment-flow.md`、`docs/provider-adapter.md`、
`docs/webhook-design.md`、`docs/refund-design.md` 以及改动目录下的 `AGENTS.md`。

## 2. 目标与非目标

### 2.1 本阶段目标

1. 清理会阻断支付宝安全接入的代码级 P0 问题。
2. 通过统一 Provider 接口支持支付宝 PC 网页支付。
3. 对支付宝异步通知进行验签、身份/金额校验、持久化去重和异步处理。
4. 支持主动支付查询、关闭过期交易、幂等退款及退款结果查询。
5. 保证 Stripe、PayPal 的支付、退款、Webhook、对账测试不回退。
6. 所有支付宝业务测试都能在没有真实密钥的 CI 中通过；真实沙箱测试由显式开关启用。

### 2.2 本阶段非目标

- 手机网站支付、当面付、小程序支付、App 支付
- 分账、代付、订阅、预授权、营销券和跨境支付
- 管理后台 MFA/双人审批的完整实现
- 生产容器、云资源和账本不可变存储的整体重构
- 自动申请支付宝商户、应用或生产证书

上述非目标记录在第 13 节的生产路线中，不应阻塞 Stage 11 沙箱验收。

## 3. 不可破坏的领域约束

1. 浏览器跳转和 `return_url` 永远不是到账依据。
2. 一笔 Order 最多只能有一笔成功或已退款的 Payment。
3. 支付、退款 Provider 调用必须使用持久化的稳定幂等标识。
4. 金额始终以整数最小单位存储；支付宝只接受 CNY，分与元之间禁止浮点计算。
5. Provider 响应、通知和查询结果必须匹配本地应用、商户、订单、金额和币种。
6. 未知结果不得武断标记失败；必须保留为可重试/可查询状态。
7. 成功、部分退款、全额退款等终态不得被迟到事件回退。
8. Provider SDK 类型、错误和传输细节不得穿透 `payment-core` 边界。

## 4. 工作包 A：代码级 P0 加固

### A1. 统一质量命令

- 新增无歧义根脚本 `verify`，内容等价于现有质量流水线。
- 文档和新 CI 调用使用 `pnpm run verify`。
- 可以保留 `ci` 兼容脚本，但不得再把 `pnpm ci` 写成项目质量命令。

### A2. 密钥扫描

扩展 `scripts/scan-secrets.mjs`，至少识别：

- Stripe、PayPal、JWT、数据库 URL 中的明文凭据
- `BEGIN ... PRIVATE KEY`、RSA/EC/OpenSSH 私钥
- 支付宝应用私钥及证书私钥文件
- 常见 `.pem`、`.key`、`.p12`、`.pfx` 密钥文件进入 Git 的情况

测试夹具只允许使用明确的假密钥标识，并通过精确文件白名单排除；不得使用会掩盖真实泄漏的
全局忽略规则。CI 后续可叠加 Gitleaks，但本阶段不能依赖外部服务才能运行。

### A3. 生产 Swagger

- 非生产环境可以默认开启 Swagger。
- `NODE_ENV=production` 时默认不注册 `/docs` 和 `/openapi.json`。
- 仅当显式配置 `ENABLE_SWAGGER=true` 时允许生产启用，并记录不含凭据的启动告警。

### A4. 过期 Checkout 生命周期

- `checkoutExpiresAt <= now` 时不得返回旧 Checkout URL。
- 创建新支付尝试前必须查询旧 Provider 交易；查询成功则投影成功，不再创建新交易。
- 仍待支付的远端交易应通过 Provider 的关闭/取消能力结束，再把本地尝试终结。
- Provider 查询或关闭结果未知时，保留现有尝试并返回可重试错误，禁止生成第二个交易号。
- 增加定时恢复流程，处理长期 `PENDING`/`PROCESSING` 和已过期 Checkout。
- 并发创建五次支付，最终只允许出现一个有效 Provider 商户交易号。

### A5. 依赖和 Swagger 风险

- 将存在安全公告的 `js-yaml` 解析链升级或通过精确 `pnpm.overrides` 固定到修复版本。
- 执行完整测试验证 `@nestjs/swagger` 兼容性。
- 在质量命令中加入生产依赖审计；若审计工具因外部网络不可用，应清楚报告而不是伪造通过。

## 5. 工作包 B：Provider 中立化

### B1. Provider 名称

在共享类型、Prisma enum、DTO、注册表、API、Worker、对账、管理后台和 Web UI 中增加
`ALIPAY`。使用新增 Prisma migration，禁止编辑旧 migration。

### B2. 创建支付结果

Provider contract 应区分：

- `merchantReference`：PayFlow 发送给 Provider 的稳定商户交易号；支付宝为 `out_trade_no`
- `providerPaymentId`：Provider 生成的支付/交易 ID；支付宝通常在通知或查询后得到 `trade_no`
- `checkoutUrl`、`checkoutExpiresAt`

支付宝生成跳转页时可能还没有 `trade_no`，不得伪造
`providerCheckoutSessionId`。Stripe、PayPal 可保留兼容字段，但业务代码应逐步使用中立字段。

### B3. Webhook 验证输入

验证输入至少包含 `contentType`、原始 `Buffer`、标准化 headers，以及可选的已解析表单。
每个适配器自行提取签名材料：Stripe 使用精确原始字节；PayPal 使用传输头；支付宝使用
`application/x-www-form-urlencoded` 字段和 `sign`。

### B4. 查询和退款能力

Provider 接口需要明确支持：

- `getPayment`
- 可选 `closePayment`/`cancelPayment`
- `refundPayment`
- `getRefund` 或语义等价的退款查询

对账与退款服务不得再硬编码仅有 `STRIPE | PAYPAL`。

## 6. 工作包 C：支付宝适配器

新增 `packages/payment-alipay`，采用官方 `alipay-sdk`，锁定确切版本并提交 lockfile。
适配器不得依赖 NestJS、Prisma 或 PayFlow 数据库类型。

### C1. 配置

至少支持：

- `ALIPAY_ENABLED`
- `ALIPAY_ENV=sandbox|production`
- `ALIPAY_APP_ID`
- `ALIPAY_SELLER_ID`
- `ALIPAY_GATEWAY_URL`
- `ALIPAY_NOTIFY_URL`
- `ALIPAY_RETURN_URL`
- 应用私钥 Secret 引用
- 支付宝公钥或应用/支付宝/根证书 Secret 引用

要求：

- 配置缺失时启动失败或 Provider 明确不可用，不能静默降级。
- sandbox 与 production 网关、密钥不可混用。
- production 强制证书模式和 RSA2；sandbox 可支持公钥模式以方便开发。
- 私钥内容、证书内容、签名、完整签名 URL 不得进入日志。
- 前后端重定向仅允许配置中精确列出的支付宝网关 Host，禁止 `*.alipay.com` 通配。

### C2. 商户交易号和金额

- 每个 Payment attempt 生成稳定、唯一、长度不超过 64 的 `out_trade_no`。
- 同一尝试的重试复用同一号码和请求参数指纹。
- ALIPAY checkout 遇到非 CNY 订单必须在 Provider 调用前拒绝。
- 实现经过测试的 `minorUnitsToAlipayAmount` 和反向解析函数；例如 `1 -> "0.01"`、
  `12345 -> "123.45"`，禁止 `Number.toFixed`、`parseFloat` 等浮点路径。
- `subject` 由服务端生成、做长度和字符限制，不接收浏览器自由文本。

### C3. 创建支付

调用 `alipay.trade.page.pay`，使用 `FAST_INSTANT_TRADE_PAY`，设置稳定的
`out_trade_no`、准确的 `total_amount`、`subject`、`notify_url`、`return_url` 和合理的
`timeout_express`。返回 Provider 托管 URL；该 URL 不应长期记录在日志或审计元数据中。

### C4. 支付查询与关闭

- 使用 `alipay.trade.query` 恢复回调丢失或请求结果未知的交易。
- 只有明确未支付且可关闭的交易才调用 `alipay.trade.close`。
- 创建新 `out_trade_no` 前，必须证明旧交易未成功且已经结束。
- 对网络、超时、限流和 5xx 使用有界重试、指数退避及随机抖动。

### C5. 状态映射

- `WAIT_BUYER_PAY` -> `PENDING`
- `TRADE_SUCCESS`、`TRADE_FINISHED` -> `SUCCEEDED`
- `TRADE_CLOSED` 需要结合本地支付状态和退款字段处理：
  - 本地未成功且没有退款证据时，可作为未支付关闭；
  - 本地已经成功或存在退款证据时，不得回退为失败，应进入退款同步/人工对账路径。
- 未知状态失败关闭，保留安全错误和 Provider request ID。

## 7. 工作包 D：支付宝异步通知

新增 `POST /webhooks/alipay`：

1. 仅接受 `application/x-www-form-urlencoded`，并设置较小且明确的 body size 上限。
2. 保留用于验签的完整字段，不进行重复 URL decode。
3. 使用官方 SDK 验证 RSA2 签名。
4. 验证 `app_id`、`seller_id`/商户身份、`out_trade_no`、准确 `total_amount`。
5. 只在验证完成后持久化；`notify_id` 作为 Provider event ID。
6. 保存标准化业务字段和 payload hash。若保留原始 payload，应加密并允许 TTL 清理；日志禁止输出。
7. Inbox 事务提交后，精确返回 `Content-Type: text/plain` 的 `success`，不得返回 JSON、空格、
   HTML 或重定向。
8. 验签失败、身份/金额不符、数据库未持久化时不得返回 `success`。

### D1. Redis 与 ACK 解耦

Webhook ACK 不应依赖 Redis：

- HTTP 事务只负责验证、去重和落地 `RECEIVED` Inbox。
- 独立 Inbox Dispatcher 使用租约或 `FOR UPDATE SKIP LOCKED` 扫描未入队事件。
- 使用 WebhookEvent UUID 作为确定性 BullMQ job ID。
- 入队失败保留 `RECEIVED`，Dispatcher 后续重试。
- 监控 `inbox_received_total`、`inbox_dispatch_lag_seconds`、失败次数和最老事件年龄。

Stripe 和 PayPal 应迁移到同一 ACK 模型；不得为支付宝建立无法复用的第二套可靠性逻辑。

## 8. 工作包 E：支付宝退款

- `out_request_no` 使用持久化的退款请求引用，长度不超过 64，同一退款重试必须复用。
- 调用 `alipay.trade.refund` 时校验 Payment、交易号、累计退款上限和币种。
- `code=10000` 仅表示接口请求成功；只有 `fund_change=Y` 可直接投影退款成功。
- `fund_change=N`、字段缺失、网络超时或响应不确定时保持 `PENDING/UNKNOWN`，使用
  `alipay.trade.fastpay.refund.query` 查询。
- Provider 调用的退款重试保持至少三秒间隔；本地仍使用支付级锁序列化余额预占。
- 部分退款、全额退款和迟到通知不得造成累计退款超额或状态回退。

## 9. 工作包 F：查询、对账与效率

### F1. 支付恢复计划

对未终结支付宝 Payment 采用分层查询，例如 15 秒、30 秒、1 分钟、2 分钟、5 分钟，
随后降低频率；使用 jitter 避免同时唤醒。查询必须具备 Provider 级并发上限和速率限制。

### F2. 对账扩展

修复当前“最多 2,000 条、按最旧排序、逐条串行查询”的实现：

- 使用游标分页和持久化 checkpoint，确保窗口内记录不会饿死。
- 按 Provider 分组并使用有界并发、令牌桶、熔断和 bulkhead。
- 记录本地/Provider 快照、差异、对账滞后和最后成功 checkpoint。
- Stage 11 先实现交易查询对账；支付宝日账单和银行结算三方对账可以作为后续独立任务。

## 10. 工作包 G：API 与 Web UI

- Checkout DTO 和 UI Provider 选项增加 ALIPAY。
- 增加至少一个 CNY 商品/测试夹具；不得把现有 USD 商品伪装成人民币支付。
- 支付跳转目标必须通过精确 Host allowlist。
- 支付结果页继续只查询 PayFlow API 的权威状态。
- 两秒固定轮询改为有上限的指数退避；页面隐藏时暂停，恢复可见时立即刷新。
- 页面文案区分“等待买家支付”“处理中”“已到账”“支付关闭”“结果确认中”。
- 遵守 `apps/web/AGENTS.md`，并保持键盘操作、焦点、颜色和移动端布局可用。

## 11. 自动化测试和验收

### 11.1 单元测试

- 分/元精确转换及边界值
- `out_trade_no`、`out_request_no` 的稳定性、长度和参数指纹冲突
- 支付/退款状态映射，包括 `TRADE_CLOSED` 的防回退逻辑
- 表单签名验证、单次 decode、证书/公钥配置错误
- Provider 错误的 retryable 与 outcomeUnknown 分类

### 11.2 集成及对抗测试

- 五个并发 checkout 请求只创建一个有效交易
- 相同 `notify_id` 重放只投影一次，delivery count 增加
- 错误签名、app、seller、订单、金额全部拒绝且不修改资金状态
- 乱序通知和迟到通知不能回退终态
- Redis 停止时，已持久化通知仍返回 `success`，恢复后 Dispatcher 能补投
- 伪造 `return_url` 不能把订单改为已支付
- 支付查询能补偿丢失通知
- 退款超时后同 `out_request_no` 查询/重试不产生第二笔退款

### 11.3 真实沙箱测试（显式开关）

- 支付成功、用户取消、超时关闭、通知丢失后的主动查询
- 部分退款、全额退款、重复退款请求、未知结果查询
- 所有真实凭据只从进程 Secret 注入，报告中不得出现密钥、签名或完整买家信息

### 11.4 Definition of Done

- `pnpm run verify` 通过
- 所有新增迁移可以从空数据库部署，也能从当前 main 升级
- Stripe 和 PayPal 既有测试全部通过
- 不配置支付宝时现有本地开发流程不受影响
- 配置支付宝沙箱时，支付、通知、查询、退款主链路可运行
- Git diff 中没有真实密钥、证书或测试账号
- README、`.env.example` 和相关设计文档与实现一致

## 12. 实施顺序与提交边界

建议按以下独立、可回滚的逻辑批次实施，不要求实际提交：

1. P0 基础加固：质量命令、密钥扫描、Swagger、依赖修复。
2. Provider contract 与 Prisma additive migration。
3. 支付宝 adapter 及纯单元测试。
4. API/Worker 组合、Webhook Inbox Dispatcher 和支付宝通知。
5. Checkout 过期恢复、主动查询和对账分页/并发。
6. 支付宝退款及退款查询。
7. Web UI、CNY fixture、E2E、文档和完整回归。

每一批都必须保持类型检查和已有 Provider 测试可运行。发现设计与本文冲突时，优先保护第 3 节
的领域约束，并在本文追加 ADR 或偏差说明，不能静默改变资金语义。

## 13. 真实资金上线前路线

Stage 11 通过不等于可收真实资金。生产前还需要：

1. 浏览器 Token 从 `sessionStorage` 迁移到安全会话/BFF；退款管理员启用 MFA、step-up 和大额双人审批。
2. 私钥使用 KMS/HSM 或只读 Secret Mount；建立密钥轮换和吊销 Runbook。
3. 容器非 root、多阶段构建、只读文件系统；迁移作为独立 Job，启动时禁止 seed。
4. PostgreSQL/Redis 私网 TLS、备份恢复演练、容量和故障转移测试。
5. 原始通知最小化、加密、访问审计和 TTL 清理，定义个人信息保留策略。
6. 账本使用仅追加权限，增加手续费、结算、退款、争议、悬账科目及日账单/银行结算核对。
7. CI 增加 Gitleaks、CodeQL/SAST、依赖审计、SBOM、镜像扫描、Dependabot/Renovate。
8. 使用 feature flag、低交易限额和 canary 商户逐步放量，并为 Inbox lag、未知支付/退款和资金差异告警。

只有完成生产安全评审、支付宝应用审核和真实小额端到端验证后，才能启用 production 网关。
