import * as THREE from 'three'

/**
 * 昼夜系统：灯光组 / 后处理调色 / 星野 的目标值与 1.2s 平滑过渡。
 * mode: 'day' | 'night'
 */
export interface DayNightPalette {
  key: { color: number; intensity: number }
  fill: { color: number; intensity: number }
  rim: { color: number; intensity: number }
  hemi: { sky: number; ground: number; intensity: number }
  bloom: number
  /** 背景板调色：乘性色温 + 加性辉光 */
  backdropMul: THREE.Color
  backdropAdd: THREE.Color
  /** 星野可见度 */
  stars: number
  /** 后处理整体调色 */
  gradeMul: THREE.Color
  gradeAdd: THREE.Color
}

export const DAY_PALETTE: DayNightPalette = {
  key: { color: 0xfff2e0, intensity: 1.15 },
  fill: { color: 0xffd6ea, intensity: 0.55 },
  rim: { color: 0xffffff, intensity: 0.45 },
  hemi: { sky: 0xffe6f2, ground: 0xffdce8, intensity: 0.65 },
  bloom: 0.32,
  backdropMul: new THREE.Color(1.0, 0.99, 0.97),
  backdropAdd: new THREE.Color(0.0, 0.0, 0.01),
  stars: 0,
  gradeMul: new THREE.Color(1, 1, 1),
  gradeAdd: new THREE.Color(0, 0, 0),
}

export const NIGHT_PALETTE: DayNightPalette = {
  key: { color: 0x8fa4ff, intensity: 0.6 },
  fill: { color: 0xb48ce8, intensity: 0.38 },
  rim: { color: 0xcfe0ff, intensity: 0.75 },
  hemi: { sky: 0x6f7fd0, ground: 0x2a2a55, intensity: 0.45 },
  bloom: 0.6,
  backdropMul: new THREE.Color(0.5, 0.56, 0.82),
  backdropAdd: new THREE.Color(0.015, 0.02, 0.05),
  stars: 1,
  gradeMul: new THREE.Color(0.82, 0.85, 1.0),
  gradeAdd: new THREE.Color(0.01, 0.012, 0.035),
}

export class DayNightController {
  mode: 'day' | 'night' = 'day'
  private blend = 0 // 0=day 1=night
  private target = 0
  private current: DayNightControllerSnapshot = snapshotFromPalette(DAY_PALETTE)

  constructor() {
    this.current = snapshotFromPalette(DAY_PALETTE)
  }

  setMode(mode: 'day' | 'night') {
    this.mode = mode
    this.target = mode === 'night' ? 1 : 0
  }

  /** 过渡进度（供 UI/场景查询） */
  get value(): number {
    return this.current.blend
  }

  update(dt: number) {
    const speed = 1 / 1.2 // 1.2s 完成
    const next = THREE.MathUtils.clamp(
      this.blend + Math.sign(this.target - this.blend) * dt * speed,
      0,
      1,
    )
    this.blend = next
    const eased = easeInOut(next)
    this.current = mixSnapshot(DAY_PALETTE, NIGHT_PALETTE, eased)
    this.current.blend = eased
  }

  get snapshot(): DayNightControllerSnapshot {
    return this.current
  }
}

export interface DayNightControllerSnapshot {
  key: { color: THREE.Color; intensity: number }
  fill: { color: THREE.Color; intensity: number }
  rim: { color: THREE.Color; intensity: number }
  hemi: { skyColor: THREE.Color; groundColor: THREE.Color; intensity: number }
  bloom: number
  backdropMul: THREE.Color
  backdropAdd: THREE.Color
  stars: number
  gradeMul: THREE.Color
  gradeAdd: THREE.Color
  blend: number
}

function snapshotFromPalette(p: DayNightPalette): DayNightControllerSnapshot {
  return {
    key: { color: new THREE.Color(p.key.color), intensity: p.key.intensity },
    fill: { color: new THREE.Color(p.fill.color), intensity: p.fill.intensity },
    rim: { color: new THREE.Color(p.rim.color), intensity: p.rim.intensity },
    hemi: {
      skyColor: new THREE.Color(p.hemi.sky),
      groundColor: new THREE.Color(p.hemi.ground),
      intensity: p.hemi.intensity,
    },
    bloom: p.bloom,
    backdropMul: p.backdropMul.clone(),
    backdropAdd: p.backdropAdd.clone(),
    stars: p.stars,
    gradeMul: p.gradeMul.clone(),
    gradeAdd: p.gradeAdd.clone(),
    blend: 0,
  }
}

function mixSnapshot(a: DayNightPalette, b: DayNightPalette, t: number): DayNightControllerSnapshot {
  const s = snapshotFromPalette(a)
  s.key.color.lerp(new THREE.Color(b.key.color), t)
  s.key.intensity = THREE.MathUtils.lerp(a.key.intensity, b.key.intensity, t)
  s.fill.color.lerp(new THREE.Color(b.fill.color), t)
  s.fill.intensity = THREE.MathUtils.lerp(a.fill.intensity, b.fill.intensity, t)
  s.rim.color.lerp(new THREE.Color(b.rim.color), t)
  s.rim.intensity = THREE.MathUtils.lerp(a.rim.intensity, b.rim.intensity, t)
  s.hemi.skyColor.lerp(new THREE.Color(b.hemi.sky), t)
  s.hemi.groundColor.lerp(new THREE.Color(b.hemi.ground), t)
  s.hemi.intensity = THREE.MathUtils.lerp(a.hemi.intensity, b.hemi.intensity, t)
  s.bloom = THREE.MathUtils.lerp(a.bloom, b.bloom, t)
  s.backdropMul.copy(a.backdropMul).lerp(b.backdropMul, t)
  s.backdropAdd.copy(a.backdropAdd).lerp(b.backdropAdd, t)
  s.stars = THREE.MathUtils.lerp(a.stars, b.stars, t)
  s.gradeMul.copy(a.gradeMul).lerp(b.gradeMul, t)
  s.gradeAdd.copy(a.gradeAdd).lerp(b.gradeAdd, t)
  return s
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
