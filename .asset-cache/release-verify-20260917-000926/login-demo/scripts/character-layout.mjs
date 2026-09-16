const hairRoot = [970, 95]
const veilRoot = [944, 65]
const bodyTransform = { sourceAnchor: [1040, 248], anchor: [1040, 210], scale: 1, angle: 0 }
const veilTransform = { sourceAnchor: [1106, 83], anchor: veilRoot, scale: 0.77, angle: 12 }
const bodySilhouette = 'M 0 279 H 995 L 1012 297 L 1036 314 H 1280 V 720 H 0 Z M 1000 207 L 1050 211 L 1037 240 L 1031 252 L 1041 266 L 1022 281 L 995 303 L 975 295 L 973 277 L 995 260 Z'
const hairMotion = { root: hairRoot, tip: [225, 540], pin: [155, 270], amplitude: 16, frequency: 1.1, phase: 0.6 }
const veilMotion = { root: veilRoot, tip: [205, 350], pin: [175, 265], amplitude: 21, frequency: 1.25, phase: 1.1 }

export const characterLayout = {
  version: 3,
  canvas: [1280, 720],
  density: 1.5,
  anchors: { head: [970, 62], face: [1017, 218], hand: [1208, 615], hairRoot, fingertip: [1244, 658] },
  faceBounds: [975, 155, 82, 128],
  connections: [
    { id: 'scalp', center: [990, 132], radius: 28, layers: ['back-hair', 'front-hair'] },
    { id: 'nape', center: [993, 249], radius: 8, layers: ['back-hair', 'body', 'body-front', 'front-hair'] },
  ],
  occlusion: { minimumCoverage: 0.98, safetyPixels: 3, hand: 'M 1090 522 L 1138 510 L 1280 610 V 702 H 1170 L 1100 577 Z' },
  layers: [
    { id: 'body', source: '角色本身.png', ...bodyTransform, motion: 'fixed', keep: bodySilhouette },
    { id: 'back-hair', source: '后发发片.png', sourceAnchor: [1105, 65], anchor: hairRoot, scale: 0.83, angle: -6, motion: 'hair', ...hairMotion, targetKeep: 'M 0 0 H 995 L 1012 72 L 1024 105 L 1040 148 H 1280 V 720 H 0 Z' },
    { id: 'body-front', source: '角色本身.png', ...bodyTransform, motion: 'fixed', keep: bodySilhouette, targetKeep: 'M 985 137 H 1145 L 1280 542 V 720 H 1095 L 1025 408 L 978 272 Z' },
    { id: 'front-hair', source: '前发发片.png', sourceAnchor: [742, 108], anchor: [971, 72], scale: 0.36, angle: 0, motion: 'fringe', root: [991, 103], tip: [1040, 285], pin: [110, 155], amplitude: 2, frequency: 1.6, phase: 1.4 },
    { id: 'ribbon-upper', source: '头纱飘带.png', sourceAnchor: [1160, 114], anchor: veilRoot, scale: 0.73, angle: 10, motion: 'ribbon', ...veilMotion, amplitude: 24, phase: 2.1, opacity: 0.6, keep: 'M 45 553 C 160 349 397 286 600 350 C 810 338 1000 154 1218 53 L 1235 167 C 1026 343 822 445 645 440 C 396 356 223 386 45 553 Z' },
    { id: 'ribbon-lower', source: '头纱飘带.png', sourceAnchor: [1160, 114], anchor: veilRoot, scale: 0.73, angle: 10, motion: 'ribbon', ...veilMotion, amplitude: 27, phase: 2.8, opacity: 0.56, keep: 'M 0 720 C 35 558 288 533 449 551 C 661 527 908 355 1196 130 L 1220 216 C 1022 408 786 607 507 675 C 289 680 135 617 0 720 Z' },
    { id: 'veil', source: '头纱本体.png', ...veilTransform, motion: 'veil', ...veilMotion, split: 'cloth' },
    { id: 'ornament', source: '头纱本体.png', ...veilTransform, motion: 'fixed', root: veilRoot, split: 'attachment' },
  ],
}
