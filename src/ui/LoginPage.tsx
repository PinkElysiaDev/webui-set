import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Stage } from '../scene/stage'
import { DEMO_TOKEN_KEY } from '../app/App'
import { ParticleButton } from './ParticleButton'
import { SealToggle } from './SealToggle'
import { TokenLineInput } from './TokenLineInput'

/**
 * 登录展示页：右侧风吹花海 + MMD 长发角色（canvas），左侧玻璃态表单（DOM）。
 * 密钥固定 123；成功转场 = 风息 → 角色开心 → 光晕扩散 → 进入 /home。
 */
export function LoginPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const haloRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [night, setNight] = useState(false)
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mountRef.current) return
    const stage = new Stage(mountRef.current, {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onProgress: (ratio) => {
        if (ratio >= 1) setReady(true)
      },
    })
    stageRef.current = stage
    return () => {
      stage.dispose()
      stageRef.current = null
    }
  }, [])

  function toggleNight() {
    const next = !night
    setNight(next)
    stageRef.current?.dayNight.setMode(next ? 'night' : 'day')
    document.documentElement.classList.toggle('theme-night', next)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const token = value.trim()
    if (!token) {
      setError('请输入 Panel Access Token')
      return
    }
    if (token !== '123') {
      setError('密钥不正确（demo 密钥为 123）')
      return
    }
    setLoading(true)
    setError(null)
    stageRef.current?.calmWind() // 风息
    stageRef.current?.setHappyMood() // 角色开心
    setTimeout(() => haloRef.current?.classList.add('play'), 350) // 光晕
    setTimeout(() => {
      sessionStorage.setItem(DEMO_TOKEN_KEY, '123')
      window.location.hash = '#/home'
    }, 1150)
  }

  return (
    <div>
      <div ref={mountRef} className="stage-root" />
      <div className="login-layer">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand">
            <b>Elysia API</b>
            <span>Console</span>
          </div>
          <h1 className="title">Panel Access Token</h1>
          <TokenLineInput
            value={value}
            onChange={(next) => {
              setValue(next)
              setError(null)
            }}
          />
          {error && <div className="error-tip">{error}</div>}
          <ParticleButton loading={loading}>
            {loading ? '身份验证中…' : ready ? '立即登录' : '场景加载中…'}
          </ParticleButton>
        </form>
      </div>
      <SealToggle night={night} onToggle={toggleNight} />
      <div ref={haloRef} className="halo" aria-hidden />
      <div className="credits">
        模型：神帝宇 制作 · 版权 miHoYo · 仅内部展示（禁二次配布 / 禁商用）
      </div>
    </div>
  )
}
