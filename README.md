# Azure Training Platform

Azure 认证考试刷题平台，当前提供 AI-103 与 DP-600 题库。

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

访问 <http://localhost:5000/>。数据保存在 `azure_training_data` Docker volume 中。镜像为 `calvinwyc/azure-training-platform:1.0.13`。

## 发布规则

版本使用 `MAJOR.MINOR.PATCH`，修复或新增课程题库递增 PATCH。发布前执行 `docker compose up --build -d`，确认 `http://localhost:5000/` 返回 200；提交后使用 `gh auth setup-git` 推送 GitHub `main` 和版本 tag，并推送 `calvinwyc/azure-training-platform:<tag>` 到 Docker Hub。发布完成后再次执行 `docker compose up -d` 保持本地 Docker 服务运行。

```bash
docker build -t calvinwyc/azure-training-platform:1.0.0 .
docker push calvinwyc/azure-training-platform:1.0.0
git tag 1.0.0
git push origin main --tags
```
