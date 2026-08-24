# Release Checklist

1. 默认递增 PATCH 版本并运行 `python -m py_compile src/server.py`。
2. 执行 `docker compose up --build -d` 并验证登录、课程选择器以及 AI-103、DP-600 题库。
3. 将版本 tag 推送到 GitHub `main`。
4. 推送 `calvinwyc/azure-training-platform:<tag>` 到 Docker Hub。
