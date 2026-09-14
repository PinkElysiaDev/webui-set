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

> 注：发行压缩包（login-demo.zip）已自带 `public/assets/scene/` 三张花海图，
> 解压即用；本说明仅供从 git 仓库克隆时手动补图。花海图为自行生成素材，
> 不受已移除的 MMD 模型使用条款约束。
