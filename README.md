# Azure Training Platform

Azure 认证考试刷题平台，当前提供 AI-103 题库，并已预留 DP-600 课程入口。

## 目录

- `src/`：前端页面、浏览器逻辑与 Python 服务端
- `data/`：题库源文件
- `assets/`：课程静态资源
- `scripts/`：发布与维护脚本
- `deploy/`：部署说明

## 本地运行

```bash
docker compose up --build -d
```

访问 <http://localhost/>。数据保存在 `azure_training_data` Docker volume 中。

## 发布规则

版本使用 `MAJOR.MINOR.PATCH`，修复或新增课程题库递增 PATCH（例如 `1.0.0` -> `1.0.1`）。每次发布创建 Git tag，推送 GitHub `main`，并推送 `calvinwyc/azure-training-platform:<tag>` 到 Docker Hub。

```bash
docker build -t calvinwyc/azure-training-platform:1.0.0 .
docker push calvinwyc/azure-training-platform:1.0.0
git tag 1.0.0
git push origin main --tags
```
