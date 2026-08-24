# Release Checklist

1. 默认递增 PATCH 版本，并同步更新 `docker-compose.yml`、README 和发布标签。
2. 运行语法检查：`node --check src/app.js`、`node --check src/sw.js`、`python -m py_compile scripts/*.py`。
3. 本地构建并启动 Docker：`docker compose up --build -d`。
4. 验证本地服务：`Invoke-WebRequest http://localhost:5000/` 应返回 200；`docker compose ps` 应显示 `0.0.0.0:5000->5000/tcp`。
5. 提交代码并创建版本标签：`git add . && git commit -m "..." && git tag v<version>`。
6. 配置 GitHub CLI 凭据：`gh auth status`；如 Git HTTPS 直接推送失败，运行 `gh auth setup-git`。
7. 推送 GitHub：`git push origin main && git push origin v<version>`。
8. 构建并推送 Docker Hub：`docker compose build && docker push calvinwyc/azure-training-platform:<version>`。
9. 再次执行 `docker compose up -d`，确认发布后的本地容器仍在 5000 端口运行。

Compose 必须使用 `0.0.0.0:5000:5000`，容器内服务必须监听 5000。
