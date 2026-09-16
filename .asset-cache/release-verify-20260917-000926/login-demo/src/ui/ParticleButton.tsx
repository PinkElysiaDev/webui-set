import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSceneTheme } from '../app/theme'

/**
 * 混沌轨道粒子按钮：每颗粒子独立双频谐和轨道（准周期、不重复、可交叉），
 * 悬停时从原位起跳并沿轨道游走，离开齐灭。轨道参数挂载时随机一次。
 *
 * 去同步起步：每轴的两项谐波随机取 sin（t=0 零位移、初速 sign×ωa）或
 * 偏移 cos（t=0 零位移零速度、随机符号加速度），type/sign/amp/ω 全随机
 * ——触发瞬间各粒子的方向、速度、加速度即各不相同，无齐射阶段。
 */
interface HarmonicTerm {
  /** 0: sin(ωt)；1: cos(ωt) − 1（两项在 t=0 位移均为零） */
  type: 0 | 1
  sign: 1 | -1
  omega: number
  amp: number
}

interface OrbitParticle {
  left: string
  top: string
  size: number
  delay: number
  tint: boolean
  tx: [HarmonicTerm, HarmonicTerm]
  ty: [HarmonicTerm, HarmonicTerm]
}

const HOMES: { left: string; top: string; size: number; delay: number; tint?: boolean }[] = [
  { left: '7%', top: '45%', size: 3, delay: 0 },
  { left: '13%', top: '90%', size: 2, delay: 90, tint: true },
  { left: '21%', top: '25%', size: 4, delay: 40 },
  { left: '31%', top: '95%', size: 2, delay: 140 },
  { left: '40%', top: '35%', size: 3, delay: 20, tint: true },
  { left: '49%', top: '75%', size: 2, delay: 110 },
  { left: '58%', top: '30%', size: 4, delay: 70 },
  { left: '67%', top: '85%', size: 3, delay: 160, tint: true },
  { left: '76%', top: '40%', size: 2, delay: 50 },
  { left: '84%', top: '70%', size: 3, delay: 130 },
  { left: '91%', top: '95%', size: 2, delay: 90, tint: true },
  { left: '96%', top: '35%', size: 4, delay: 30 },
]

const OMEGAS = [0.35, 0.5, 0.65, 0.8, 1.0, 1.2, 1.5] as const

function makeOrbits(): OrbitParticle[] {
  const pick = (exclude?: number) => {
    let value = OMEGAS[Math.floor(Math.random() * OMEGAS.length)]
    while (value === exclude) value = OMEGAS[Math.floor(Math.random() * OMEGAS.length)]
    return value
  }
  const makeTerm = (exclude?: number): HarmonicTerm => ({
    type: Math.random() < 0.5 ? 0 : 1,
    sign: Math.random() < 0.5 ? 1 : -1,
    omega: pick(exclude),
    amp: 4 + Math.random() * 9,
  })
  return HOMES.map((home) => {
    const tx1 = makeTerm()
    const ty1 = makeTerm()
    return {
      ...home,
      tint: home.tint ?? false,
      tx: [tx1, makeTerm(tx1.omega)],
      ty: [ty1, makeTerm(ty1.omega)],
    }
  })
}

function termAt(term: HarmonicTerm, t: number): number {
  const phase = term.type === 0 ? Math.sin(term.omega * t) : Math.cos(term.omega * t) - 1
  return term.sign * term.amp * phase
}

export function ParticleButton({
  loading,
  children,
}: {
  loading: boolean
  children: ReactNode
}) {
  const [orbits] = useState(makeOrbits)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const { reducedMotion } = useSceneTheme()
  const active = (hovered || focused) && !loading
  const layerRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef(0)

  useEffect(() => {
    if (!active || reducedMotion) return
    timeRef.current = 0 // 所有项在 t=0 位移为零：每次悬停从原位起跳
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      timeRef.current += (now - last) / 1000
      last = now
      const t = timeRef.current
      const dots = layerRef.current?.children
      if (dots) {
        for (let i = 0; i < dots.length; i += 1) {
          const o = orbits[i]
          const x = termAt(o.tx[0], t) + termAt(o.tx[1], t)
          const y = termAt(o.ty[0], t) + termAt(o.ty[1], t)
          ;(dots[i] as HTMLElement).style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, reducedMotion, orbits])

  return (
    <div
      className="particle-zone"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div ref={layerRef} className="particles" aria-hidden>
        {orbits.map((particle, index) => (
          <span
            key={index}
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              background: particle.tint ? 'var(--particle-tint)' : 'var(--primary)',
              opacity: active ? 0.8 : 0,
              transitionDelay: active && !reducedMotion ? `${particle.delay}ms` : '0ms',
            }}
          />
        ))}
      </div>
      <button type="submit" className="login-btn" disabled={loading}>
        {loading && <span className="loading-spin" aria-hidden />}
        {children}
      </button>
    </div>
  )
}
