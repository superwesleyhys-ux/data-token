# 验证记录

日期：2026-09-16。执行环境：Python 3.12.14 / Linux x86_64。

## 已执行

- `python -m unittest discover -s tests -v`：22 项测试通过。
- `python -m flowcache benchmark --repetitions 7 --output examples/benchmark.local.json`：完成，输出一致性检查通过。
- `node --check flowcache/static/app.js`：JavaScript 语法通过。
- `python -m flowcache demo --port 8080`：本地服务正常启动。
- HTTP 集成测试验证主页、计算端点、错误 Origin / Host / 缺少请求头的拒绝行为。

测试覆盖：首次与重复运行、基线不写缓存、数字变化、否定词变化、段落顺序、单段修改、工作区 / 任务版本 / 权限修订 / 指纹参数变化、TTL 与更严格的新 TTL、缓存损坏、错误输入绑定、持久化与容量、HTTP 真实传输、本地二次命中、错误密钥、下载预算、无效签名、不可达 peer、远端缓存隔离和过期时间保持。

## 验证范围

本环境没有浏览器可执行文件，Playwright 的浏览器启动未能完成，因此尚未执行浏览器视觉和点击端到端检查。界面代码通过语法检查，后端通过真实 HTTP 测试。CI 已配置 Python 3.11 / 3.12 / 3.13，但远端 CI 尚未执行；此处仅报告实际运行过的 Python 3.12 结果。

真实双设备 WiFi、macOS / Windows 启动、SSH 隧道和 HTTPS 部署尚未实测。README 提供的是运行步骤，不是这些环境已验收的声明。

## 可复查的手动路径

1. 运行 `python3 -m flowcache demo`，在浏览器打开 `http://127.0.0.1:8080`。
2. 首次计算后重复运行：7 个计算节点降为 0，结果哈希相同。
3. 修改末段：重算 2 个节点、本地命中 5 个段落。
4. 网络复用：远端命中 1 个文档节点，下载字节大于 0，重算为 0；准备成本单列。
5. 完整对照：表格展示 5 个场景，下载 JSON 可与运行计量逐项核对。
