# xml2jianpu

这个项目用来将 musicxml 文件转换为简谱。

## 部署（腾讯云 EdgeOne Makers）

1. 打开 [EdgeOne Makers 控制台](https://console.cloud.tencent.com/edgeone/pages)，开通免费版并连接 GitHub 仓库。
2. Production 分支选 `vue`；构建相关已由根目录 `edgeone.json` 配置（`npm run build` → `dist`）。
3. 保存并部署后，用控制台给出的默认域名在大陆访问验证。

本地构建：`npm run build`，产物在 `dist/`。
