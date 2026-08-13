# PayFlow 真实沙盒、对抗性与压力测试报告

日期：2026-08-13

环境：Windows 本机应用进程、Docker PostgreSQL、Redis，隔离数据库与 Redis DB

结论：Stripe 真实沙盒链路通过；对抗性测试 31/31 通过；故障实验室 10/10 通过；本地压力测试通过。

## 测试边界

- “真实数据”测试使用 Stripe 官方沙盒 API、Stripe 托管 Checkout 页面、官方测试卡和真实签名 Webhook；没有使用支付 Provider mock。
- Stripe 沙盒不会划转真实资金。按照 Stripe 的测试与限流建议，高并发压力只施加到本地 API、PostgreSQL、Redis 和 Worker，不对 Stripe 沙盒发起高频压力。
- PayPal 真实沙盒测试未执行，因为环境中没有 PayPal sandbox client ID、client secret 和 webhook ID。PayPal 的本地适配器测试仍通过。
- 本报告中的吞吐和延迟是本机基线，不代表生产容量承诺。

参考：

- [Stripe 测试环境说明](https://docs.stripe.com/testing/overview)
- [Stripe Webhook 测试说明](https://docs.stripe.com/webhooks/quickstart)
- [Stripe API 限流说明](https://docs.stripe.com/rate-limits)

## Stripe 真实沙盒结果

Stripe 沙盒账户：`acct_1U3eE3EJCMp410mV`

Stripe API 版本：`2026-07-29.dahlia`

### 成功支付与部分退款

- 本地订单：`89dbd802-d837-4a31-8312-3d107e587200`
- 本地支付：`f14cf162-ddae-49aa-bf91-7ff71c6fe9f5`
- Checkout Session：`cs_test_a1fu1Lxvauxq4b22BLbMNUJzhKc4XhAPBdTcYyhzESO9LSI8rrHkA9KD4j`
- PaymentIntent：`pi_3U3ni5EJCMp410mV1fqx2KhK`
- 支付金额：2,400 USD 最小货币单位
- Stripe 结果：Checkout `complete`、支付 `paid`、PaymentIntent `succeeded`、`livemode=false`
- 本地结果：订单 `PAID`、支付 `SUCCEEDED`
- 真实 Webhook：`payment_intent.succeeded` 与 `checkout.session.completed` 均通过签名验证并返回 HTTP 200；第二个终态事件没有重复改变状态。
- 支付账本交易：`f7111287-7c16-470b-b467-8286c5d77954`，借贷差额为 0。
- Stripe Refund：`re_3U3ni5EJCMp410mV1yHgx974`
- 本地退款：`82331f1a-c827-4244-bd31-d34e43f46025`
- 退款金额：700 USD 最小货币单位，Stripe 状态 `succeeded`
- 本地结果：订单与支付均为 `PARTIALLY_REFUNDED`、退款 `SUCCEEDED`
- 真实 Webhook：`refund.created` 与 `refund.updated` 均通过签名验证并返回 HTTP 200；同步退款结果与两个 Webhook 保持幂等。
- 退款账本交易：`ea41bccb-30ad-4e3e-9dce-850ac9419ce8`，借贷差额为 0。

### 资金不足拒付

- 本地订单：`fea9c4df-7032-4a04-9378-42f79322899c`
- 本地支付：`f0407b75-6485-4d06-a0b0-1284008426ab`
- Checkout Session：`cs_test_a1QTzwsZiDRe2UCps3AXTiNt1NOTRJSDPicMnUD8T3g2YxnfccVf5dYEBj`
- PaymentIntent：`pi_3U3np2EJCMp410mV0KD12LaB`
- 金额：3,400 USD 最小货币单位
- 官方资金不足测试卡返回 `card_declined / insufficient_funds`，PaymentIntent 保持 `requires_payment_method`，入账金额为 0。
- `payment_intent.payment_failed` 真实签名 Webhook：`evt_3U3np2EJCMp410mV0ix70cbG`
- 本地支付变为 `FAILED`，订单保持 `PENDING_PAYMENT`，没有 Outbox 或账本记录。

## 对抗性测试

黑盒脚本：`scripts/testing/adversarial.mjs`

结果：31/31 通过，覆盖：

- 畸形 JSON、超大 JSON、非法 UUID 与 DTO 白名单。
- 注册和订单字段批量赋值、角色提升与订单归属篡改。
- 缺失 JWT、畸形 Bearer、`alg=none`、签名篡改。
- USER 访问 ADMIN、跨租户读取和跨租户取消。
- SQL 注入式后台搜索输入。
- Stripe 无效签名、过期签名、并发重放去重。
- 签名正确但 `livemode=true` 的事件异步隔离为 `FAILED`。
- 签名正确但金额被篡改的支付事件异步失败，支付终态不变。
- 轮换 `X-Forwarded-For` 无法绕过当前登录限流配置。

故障实验室：10/10 通过，覆盖并发重复支付、Webhook 五次重放、过期事件防回退、Provider 超时幂等重试、进程重启恢复、重复退款、并发退款超额保护、数据库中途失败原子性、无效签名无副作用和 USER 退款越权。

## 压力测试

脚本：`scripts/testing/load.mjs`

| 场景                        | 总数 / 并发 |              吞吐 |       p50 |            p95 |       p99 | 结果                             |
| --------------------------- | ----------: | ----------------: | --------: | -------------: | --------: | -------------------------------- |
| 订单并发写入                |    100 / 50 |      270.75 req/s | 140.46 ms |      249.28 ms | 254.43 ms | 100 个 HTTP 201，100 个订单落库  |
| 含 100 个订单的完整列表读取 |    100 / 50 |      263.95 req/s | 175.36 ms |      240.73 ms | 246.15 ms | 100 个 HTTP 200，0 传输错误      |
| 商品读取                    |    120 / 60 |      662.76 req/s |  62.68 ms |      135.74 ms | 141.20 ms | 120 个 HTTP 200                  |
| 全局限流过载                |    300 / 50 |    1,417.19 req/s |  28.60 ms |       58.98 ms |  75.11 ms | 120 个 HTTP 200、180 个 HTTP 429 |
| Webhook API 入站            |  1,000 / 50 | 平均 248.73 req/s |         — | 平均 270.23 ms |         — | 1,000 个 HTTP 200                |

Webhook 完整链路结果：

- API → PostgreSQL → Redis/BullMQ → 8 并发 Worker 共处理 1,000 条签名正确的未知类型事件。
- `accepted=1000`、`IGNORED=1000`、`FAILED=0`。
- 1,000 条事件全部只投递一次、只处理一次。
- 队列端到端延迟：p50 37 ms、p95 110 ms、p99 130 ms。
- 入站结束后的队列排空等待：47.78 ms。
- 压力结束后数据库、Redis 和 API 健康检查均为 `up`。

## 压测发现并已修复

1. Express JSON 解析器抛出的超大请求异常不是 Nest `HttpException`，原统一过滤器将其错误映射为 HTTP 500。现在保留为 HTTP 413，并返回稳定错误码 `PAYLOAD_TOO_LARGE`。
2. 第一轮 100 并发订单写入只成功 96 条。PostgreSQL 返回 SQLSTATE `40001`，Prisma 7 `adapter-pg` 在事务提交阶段将其包装为 `DriverAdapterError: TransactionWriteConflict`，原逻辑只识别 `P2034`。现在数据库包统一识别两种错误形态，订单创建、订单取消、支付预留和退款预留使用同一冲突判断；最终压力测试 100/100 成功。
3. 为两项修复增加单元回归测试，并把对抗性和压力脚本加入根工作区命令。

## 尚待优化

- P1：用户订单列表没有分页。100 个订单时单次响应约 49.6 KB，突发读取 p95 已达到 240.73 ms；应在数据增长前增加游标分页。
- P1：Webhook、健康检查和普通 API 共用每实例内存限流。生产部署应为健康检查和 Provider 回调设置独立策略，并把限流状态移到 Redis 或边缘网关。
- P1：生产环境应关闭或鉴权保护 Swagger `/docs` 与 `/openapi.json`。
- P1：当前暴露过的 Stripe `sk_test` 必须轮换；应用优先使用最小权限的 `rk_test`。
- P2：后台模糊搜索和 offset 分页在大数据量下需要 trigram/专用索引与游标分页。
- P2：Web 前端目前由生产构建和浏览器验收覆盖，但缺少自动化组件/E2E 测试。

## 最终回归门禁

- `pnpm ci`：通过。
- 格式检查：通过。
- 仓库密钥扫描：通过。
- 全仓 Lint：通过。
- 全仓 TypeScript 类型检查：通过。
- 单元测试：76/76 通过。
- E2E：25/25 通过，其中故障实验室 10/10。
- 全仓生产构建：通过。
