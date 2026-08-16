# 杭州马拉松 · Sub4 打卡

个人使用的 11 周马拉松备赛应用。静态前端发布到 GitHub Pages；Node API 通过 Docker 运行在服务器 6000 端口；训练计划与打卡结果保存到 Notion。

## 本地启动

1. 在 Notion 中创建 Internal Integration，把数据库分享给该 Integration，复制 token。
2. 将 `.env.example` 中的 `NOTION_TOKEN`、`ALLOWED_ORIGINS` 补充进 `.env`。不要提交 `.env`。
3. 启动：`docker compose up -d --build`
4. 打开 `http://localhost:6000`，健康检查为 `/api/health`。

## GitHub Pages

仓库 Settings → Pages → Source 选择 **GitHub Actions**，并新增 Actions Secret：

- `API_BASE_URL`：公网可访问的后端 HTTPS 地址，例如 `https://run-api.example.com`。

GitHub Pages 是 HTTPS 页面，浏览器会阻止它调用纯 HTTP API，因此生产环境需要给后端配置 HTTPS 反向代理。后端 CORS 的 `ALLOWED_ORIGINS` 应包含 `https://wall6688.github.io`。

## Notion 数据模型

数据库保存日期、周次、训练类型、计划公里、计划内容、完成状态、实际公里、用时、配速、心率、RPE 与备注。前端只访问自己的 API，Notion token 不会进入浏览器。
