# 在本地 Codex 继续测试

当前完整 A/B 模型实验尚未完成。已完成的是本地 CPU、检索与 HTTP 环回测试；此前的 93%–99% 数据分别对应上下文缩减或特定计算复用，不能作为真实 Codex 总 token 节省率。

## 先验证项目

在仓库根目录运行，无需模型 API：

```bash
python3 -m unittest discover -s tests -v
python3 -m flowcache search "analyze_chunk re.findall numbers" --root flowcache --max-chars 4000
python3 -m flowcache demo
```

网页面板地址是 http://127.0.0.1:8080。

## 可直接交给 Codex 的任务

> 阅读 CODEX_LOCAL_TEST.md 与 experiments/model_ab/README.md。在两个独立工作目录和独立会话中，用同一模型完成相同的任务：使冻结项目 core.py 的 analyze_chunk 数字提取保留正负号。A 组只能读取 experiments/model_ab/attempt-01/A_input.txt 中的任务和完整项目；B 组先运行本地检索，只读取对应 B_input.txt 中的任务和检索结果。保持模型、推理设置与输出限制一致，两组均运行 experiments/model_ab/run.py 中的验收逻辑。不要把 A 组答案传给 B 组。记录执行端实际提供的输入、输出、缓存与推理 token，以及字节、耗时和测试结果；没有提供的字段标为 unavailable，不以分词计数冒充。只有两组质量合格才比较节省率。若需要补读文件或修复，追加调用与新增上下文也必须计入，不能忽略。保留失败样本。

如果本地 Codex 能报告实际会话 usage，可用它完成上面两次独立运行。此仓库没有自动劫持或替换 Codex 内置搜索，也没有读取其他应用的登录令牌。通过订阅登录的本地 Codex 不会自动向此 Python 脚本提供 API 密钥。

## 已准备的 API 对照执行器

可选用实际 API 调用进行受控小任务对照：

```bash
python3 experiments/model_ab/run.py --run --model YOUR_MODEL \
  --output experiments/model_ab/my-local-run
```

需要在运行环境配置 OPENAI_API_KEY，不要把密钥写入仓库。此入口按 API 计量，和 Codex 订阅用量不同。无凭据或网络不可达时会记录 blocked / incomplete。每组一次调用，不自动重试；对同一输出目录的覆盖被拒绝。

默认输入为冻结的 9,640 token 后端源代码；加入任务说明后的具体预检计数见 manifest。预检计数与 API 的实际 usage 分开保存。当前本地搜索可能截断关键上下文，纯中文检索未通过质量验收，详见 experiments/search_quality/REPORT.md。
