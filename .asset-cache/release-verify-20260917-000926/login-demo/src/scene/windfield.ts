/**
 * 全场景共享风场：屏幕空间 (uv) 采样。
 * wind = 基础风向 × 阵风包络 × calm；另有指针响应——
 * 花瓣消费逐点涡流（直接速度项，局部平滑），花海消费「气流冲击」
 * wake（欠阻尼弹簧：加速起势 → 晃两下 → 缓归环境风摆）。
 */
const WAKE_STIFFNESS = 30 // 弹簧刚度（≈0.9Hz 摆动）
const WAKE_DAMPING = 3.0 // 阻尼（ζ≈0.27，恰好晃两下后衰减）

export class WindField {
  time = 0
  /** 基础风向（屏幕空间，自右向左吹，即从角色吹向表单） */
  readonly baseDir = { x: -1, y: 0.06 }
  baseStrength = 1
  /** 登录成功转场用：1 正常 → 0 无风 */
  calm = 1
  /** 指针状态（uv 与速度），速度快速衰减（花瓣涡流消费） */
  pointer = { x: 0.5, y: 0.5, vx: 0, vy: 0 }
  /** 气流冲击（花海消费）：欠阻尼弹簧响应后的幅度矢量 */
  wake = { x: 0, y: 0 }
  private wakeVelocity = { x: 0, y: 0 }

  update(dt: number) {
    this.time += dt
    // 指针速度衰减（指数）
    const decay = Math.exp(-dt * 4)
    this.pointer.vx *= decay
    this.pointer.vy *= decay
    // 气流冲击弹簧积分（欠阻尼）
    this.wakeVelocity.x += (-WAKE_STIFFNESS * this.wake.x - WAKE_DAMPING * this.wakeVelocity.x) * dt
    this.wakeVelocity.y += (-WAKE_STIFFNESS * this.wake.y - WAKE_DAMPING * this.wakeVelocity.y) * dt
    this.wake.x = clamp(this.wake.x + this.wakeVelocity.x * dt, -1.2, 1.2)
    this.wake.y = clamp(this.wake.y + this.wakeVelocity.y * dt, -1.2, 1.2)
  }

  /** 指针移动事件（uv 坐标 + 本次位移） */
  pushPointer(x: number, y: number, dx: number, dy: number) {
    this.pointer.x = x
    this.pointer.y = y
    // 限幅防炸
    this.pointer.vx = clamp(this.pointer.vx + dx * 6, -4, 4)
    this.pointer.vy = clamp(this.pointer.vy + dy * 6, -4, 4)
    // 冲量注入气流冲击弹簧的速度项：先加速、后过冲、再晃两下缓归
    this.wakeVelocity.x = clamp(this.wakeVelocity.x + dx * 2.2, -6, 6)
    this.wakeVelocity.y = clamp(this.wakeVelocity.y + dy * 2.2, -6, 6)
  }

  /** 阵风包络 0..1：双频准周期，每 6~12s 出现一次峰值 */
  gust(): number {
    const t = this.time
    const a = Math.sin(t * 0.42 + Math.sin(t * 0.17) * 1.3)
    const b = Math.sin(t * 0.31 + 2.1)
    return clamp(0.55 + 0.45 * a * b, 0, 1)
  }

  /** 纯环境风（不含指针项）：供花海整层 uniform 使用 */
  ambient(): { x: number; y: number } {
    const factor = this.baseStrength * (0.35 + 0.65 * this.gust()) * this.calm
    return { x: this.baseDir.x * factor, y: this.baseDir.y * factor }
  }

  /** 屏幕空间风矢量（约为「每秒多少屏宽」的量级，按强度 1 采样） */
  sample(uvX: number, uvY: number): { x: number; y: number; strength: number } {
    const ambient = this.ambient()
    let x = ambient.x
    let y = ambient.y

    // 指针涡流：位置越近影响越大（花瓣逐粒消费，局部平滑）
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
