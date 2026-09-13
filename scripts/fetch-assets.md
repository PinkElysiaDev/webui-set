# 资产放置说明

模型与场景图受 使用规则.txt 约束（禁止二次配布），不入库。克隆本仓后手动放置：

```
public/assets/
├─ model/            # 整目录拷贝自解压后的「爱莉希雅律者2.0」目录
│  ├─ 爱莉希雅 3.0.pmx      （主模型，默认加载）
│  ├─ 爱莉希雅长裙 3.0.pmx   （变体，可选）
│  ├─ 法杖.pmx              （饰件，可选）
│  └─ *.png                 （贴图，必须与 pmx 同目录）
└─ backdrop.png      # 花海场景图（原文件 task-mtzyvfxf16eyz.png）
```

来源：
- 模型：`C:\Users\xiaolan\Downloads\爱莉希雅律者2.0_by_神帝宇_<hash>\爱莉希雅律者2.0\`
- 花海：`C:\Users\xiaolan\Downloads\task-mtzyvfxf16eyz.png`

放置后 `npm run dev` 即可。
