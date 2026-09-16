# 同项目、同任务的实际模型 A/B 对照

**当前没有真实模型运行结果。** `attempt-01/report.json` 的 `blocked` 状态记录本环境缺少模型凭据和模型选择，usage 未填写，不会把分词器计数冒充调用用量。

两组共用之前冻结的 6 个后端文件（9,640 个 o200k_base token），任务是修改数字提取正则，使其保留正负号。两组使用同一模型、输出上限、推理参数和六项验收用例。A 组接收全文；B 组接收本地词法搜索选出的上下文。每组独立调用 Responses API 一次，不共享会话。

本实验验证一个小代码修改任务，不是完整 Codex 产品的多轮任务或订阅额度测试。B 组依然需要模型完成修改。本地文件检索不需要流量，所以检索流量如实记录为 0；API 请求和响应的 JSON 字节分别计量。没有为了制造“烧流量”而循环下载数据，也没有声称环回网络等于用户 WiFi。

## 运行

需要 Python 3.11+。在实际运行设备中配置 `OPENAI_API_KEY`，不要粘贴到聊天，也不要写入仓库。准备本地输入不需要密钥：

```bash
python3 experiments/model_ab/run.py --output experiments/model_ab/prepared
```

执行真实两次调用，替换为你的账号可用模型：

```bash
python3 experiments/model_ab/run.py --run --model YOUR_MODEL \
  --output experiments/model_ab/my-run
```

可用 `--effort` 指定该模型支持的推理档位，`--order BA` 交换顺序。缺少密钥、权限、网络或结果 usage 时，报告保持 blocked / incomplete。请求失败不会自动重试，不读取或复制任何其他应用的登录凭据。重复实验使用新的输出目录。

输出包括原始 `usage`（输入、输出、总量和提供商返回的细项）、模型返回结果、六项测试结果、API 耗时和请求/响应 JSON 字节。缓存输入属于总输入，推理 token 属于总输出，不能重复相加。只有两组均完成、提供实际 usage、返回同一模型且任务验收都通过，才计算可比较的总 token 减少比例。一次对照不足以估计稳定平均收益。

API 费用与 ChatGPT 订阅额度不同；此脚本统计 API 响应的用量，不读写 ChatGPT 订阅计费。没有测量 HTTP 头、TLS、TCP 重传或设备网卡总流量。

实现依据：[文本生成与 Responses 请求](https://developers.openai.com/api/docs/guides/text)、[缓存与 usage 计量](https://developers.openai.com/api/docs/guides/prompt-caching)。
