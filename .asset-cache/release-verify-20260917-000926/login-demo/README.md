# Elysia API · 花海登录 Demo

2026-09-17 源码快照，独立运行，不连接主项目或后端。演示登录密钥：`123`。

发行包包含源码、三层花海、八层配准角色、静态备用资源，以及已构建的 `dist/`。
预览不需要下载目录中的原始素材，也不需要重新生成角色。
包内不含 `node_modules/`、Git 历史、缓存、运行日志和历史截图。

## 方式一：直接预览已构建版本

解压后进入 `login-demo` 目录。如果本机有 Python：

```powershell
python -m http.server 5280 --bind 127.0.0.1 --directory dist
```

浏览器打开 `http://127.0.0.1:5280/`。不要直接双击 `dist/index.html`，资源需要通过 HTTP 加载。
端口被占用时可改用其他空闲端口；在终端按 Ctrl+C 停止服务。

## 方式二：从源码运行

本机安装 Node.js / npm 后，在解压出的 `login-demo` 目录运行：

```powershell
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1
```

浏览器打开 `http://127.0.0.1:5280/`。非 Windows 环境可将 `npm.cmd` 替换为 `npm`。

构建及检查：

```powershell
npm.cmd run check:character
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 5281
```

生产版本预览地址为 `http://127.0.0.1:5281/`。

## 当前版本说明

- 五份独立素材配准为八层，manifest v3；发根固定，发尾、头纱和飘带共享风场。
- 保留原有三层花海，用真实二维 alpha 和风动安全余量约束手部与衣裙裁切边的遮挡。
- 支持昼夜切换、减少动态、资源失败／重试及静态角色降级。
- 当前 768×1024 布局无法同时满足完整头脸和遮挡约束时，会安全隐藏角色；登录仍可用。
- 原始 PNG 仅在修改素材配准并重新生成时需要，操作见 `scripts/fetch-assets.md`。
- 开发进度、验收记录与浏览器检查方式见 `PLAN.md`；`?inspect` 调试接口仅在开发服务器启用。
