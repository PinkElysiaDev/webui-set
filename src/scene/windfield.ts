/**
 * 全场景共享风场：屏幕空间 (uv) 采样。
 * wind = 基础风向 × 阵风包络 × calm + 指针扰动涡流。
 * 消费者：长发刚体（投影到 uv）、花瓣（相机空间即 uv）、背景草浪（uniform）。
 */
export class WindField {
  time = 0
  /** 基础风向（屏幕空间，自右向左吹，即从角色吹向表单） */
  readonly baseDir = { x: -1, y: 0.06 }
  baseStrength = 1
  /** 登录成功转场用：1 正常 → 0 无风 */
  calm = 1
  /** 指针状态（uv 与速度），速度快速衰减 */
  pointer = { x: 0.5, y: 0.5, vx: 0, vy: 0 }

  update(dt: number) {
    this.time += dt
    // 指针速度衰减（指数）
    const decay = Math.exp(-dt * 4)
    this.pointer.vx *= decay
    this.pointer.vy *= decay
  }

  /** 指针移动事件（uv 坐标 + 本次位移） */
  pushPointer(x: number, y: number, dx: number, dy: number) {
    this.pointer.x = x
    this.pointer.y = y
    // 限幅防炸
    this.pointer.vx = THREE_CLAMP(this.pointer.vx + dx * 6, -4, 4)
    this.pointer.vy = THREE_CLAMP(this.pointer.vy + dy * 6, -4, 4)
  }

  /** 阵风包络 0..1：双频准周期，每 6~12s 出现一次峰值 */
  gust(): number {
    const t = this.time
    const a = Math.sin(t * 0.42 + Math.sin(t * 0.17) * 1.3)
    const b = Math.sin(t * 0.31 + 2.1)
    return THREE_CLAMP(0.55 + 0.45 * a * b, 0, 1)
  }

  /** 屏幕空间风矢量（约为「每秒多少屏宽」的量级，按强度 1 采样） */
  sample(uvX: number, uvY: number): { x: number; y: number; strength: number } {
    const gust = this.gust()
    let x = this.baseDir.x * this.baseStrength * (0.35 + 0.65 * gust) * this.calm
    let y = this.baseDir.y * this.baseStrength * (0.35 + 0.65 * gust) * this.calm

    // 指针涡流：位置越近影响越大
    const dx = uvX - this.pointer.x
    const dy = uvY - this.pointer.y
    const dist2 = dx * dx + dy * dy
    const radius = 0.16
    const falloff = Math.exp(-dist2 / (radius * radius))
    x += this.pointer.vx * 0.2 * falloff * this.calm
    y += this.pointer.vy * 0.2 * falloff * this.calm

    return { x, y, strength: Math.hypot(x, y) }
  }
}

function THREE_CLAMP(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
