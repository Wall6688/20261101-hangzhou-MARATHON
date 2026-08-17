# 杭州马拉松 · Sub4 打卡

个人使用的 11 周马拉松备赛应用。前端和 Node API 通过同一个 Docker 容器运行；容器内部使用 6000，公网默认映射到浏览器允许访问的 6080 端口；训练计划与打卡结果保存到 Notion。

## 本地启动

1. 在 Notion 中创建 Internal Integration，把数据库分享给该 Integration，复制 token。
2. 将 `.env.example` 中的 `NOTION_TOKEN`、`ALLOWED_ORIGINS` 补充进 `.env`。不要提交 `.env`。
3. 启动：`docker compose up -d --build`
4. 打开 `http://localhost:6080`，健康检查为 `/api/health`。

## 服务器访问

部署后直接打开 `http://服务器地址:6080`。前端与 API 同源，不需要额外的反向代理、HTTPS 证书或跨域配置。Chromium 会拦截 6000 端口并显示 `ERR_UNSAFE_PORT`，因此不要将公网端口改回 6000。

## Notion 数据模型

数据库保存日期、周次、训练类型、计划公里、计划内容、完成状态、实际公里、用时、配速、心率、RPE 与备注。前端只访问自己的 API，Notion token 不会进入浏览器。

后端使用 `./data` 持久化最近一次成功同步的训练记录。Notion 网络暂时不可用时，页面仍会立即显示缓存；服务每 10 分钟在后台自动重试同步。缓存文件包含 Notion 页面标识，因此不会提交到 Git。
