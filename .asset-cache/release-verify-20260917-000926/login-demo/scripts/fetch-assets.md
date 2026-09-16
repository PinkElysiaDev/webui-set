# 资产放置说明

花海场景图不入库（体积大），克隆本仓后手动放置：

```
public/assets/scene/
├─ far.png    # 花海·远景（原 后景.png，须保持 3840×2160）
├─ mid.png    # 花海·中景（原 中景.png）
└─ front.png  # 花海·前景（原 前景.png）
```

来源：`C:\Users\xiaolan\Downloads\花海\`（后景/中景/前景 → far/mid/front）

放置后 `npm run dev` 即可。

## 角色独立 PNG（当前必需）

默认从 `C:\Users\xiaolan\Downloads\爱莉希雅\` 读取以下五张原始透明 PNG，均保持 3840×2160：

- `角色本身.png`
- `后发发片.png`
- `前发发片.png`
- `头纱本体.png`
- `头纱飘带.png`

完整角色、完整发片、完整头纱和场景参考只用于目视校准，不需要复制到生产资源目录。
生成器不会写入下载目录，也不会复制或改变三层花海。

```powershell
npm.cmd run assets:character
npm.cmd run check:character
```

源文件放在其他位置时：

```powershell
npm.cmd run assets:character -- --source "D:\素材\爱莉希雅"
```

输出到 `public/assets/character/`：八张配准图层、`manifest.json`（v3）、`fallback.png` 和 `fallback.json`。
必须整组部署，不能将旧 v2 的 manifest、旧尺寸 PNG 或硬编码备用图混用；旧 `hand-front.png` 不再被引用。
源散列、锚点、部件变换、连接区覆盖、风动固定区及手／衣裙遮挡区域均写入 manifest。

`check:character` 验证源层名单、纹理散列与尺寸、锚点、无头纱连接区和备用图一致性，
同时生成 `.asset-cache/character-check/` 下的放大及遮挡预览。
浏览器回归及安全降级规则见 `PLAN.md`。

> 注：发行压缩包（login-demo.zip）已自带 `public/assets/scene/` 三张花海图，
> 解压即用；本说明仅供从 git 仓库克隆时手动补图。花海图为自行生成素材，
> 不受已移除的 MMD 模型使用条款约束。
