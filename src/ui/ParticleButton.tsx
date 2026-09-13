import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 混沌轨道粒子按钮：每颗粒子独立双频谐和轨道（准周期、不重复、可交叉），
 * 悬停时从原位起跳并沿轨道游走，离开齐灭。轨道参数挂载时随机一次。
 */
interface OrbitParticle {
  left: string
  top: string
  size: number
  delay: number
  tint: boolean
  wx: [number, number]
  wy: [number, number]
  ax: [number, number]
  ay: [number, number]
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
  return HOMES.map((home) => {
    const wx1 = pick()
    const wy1 = pick()
    return {
      ...home,
      tint: home.tint ?? false,
      wx: [wx1, pick(wx1)],
      wy: [wy1, pick(wy1)],
      ax: [9 + Math.random() * 9, 4 + Math.random() * 5],
      ay: [13 + Math.random() * 13, 5 + Math.random() * 6],
    }
  })
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
  const layerRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef(0)

  useEffect(() => {
    if (!hovered) return
    timeRef.current = 0 // sin(0)=0：每次悬停从原位起跳
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
          const x = Math.sin(o.wx[0] * t) * o.ax[0] + Math.sin(o.wx[1] * t) * o.ax[1]
          const y = Math.sin(o.wy[0] * t) * o.ay[0] + Math.sin(o.wy[1] * t) * o.ay[1]
          ;(dots[i] as HTMLElement).style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hovered, orbits])

  return (
    <div
      className="particle-zone"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
              background: particle.tint ? '#f9a8c9' : 'var(--primary)',
              opacity: hovered ? 0.8 : 0,
              transitionDelay: hovered ? `${particle.delay}ms` : '0ms',
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
