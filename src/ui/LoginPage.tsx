import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Stage } from '../scene/stage'
import { errorMessage, initialSceneStatus, type SceneStatus } from '../scene/resources'
import { DEMO_TOKEN_KEY } from '../app/App'
import { useSceneTheme } from '../app/theme'
import { ParticleButton } from './ParticleButton'
import { SealToggle } from './SealToggle'
import { TokenLineInput } from './TokenLineInput'
import { SequencePanel } from './SequencePanel'

const sequenceTool = import.meta.env.DEV && new URLSearchParams(location.search).has('sequence')

export function LoginPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLFormElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const haloRef = useRef<HTMLDivElement>(null)
  const timersRef = useRef<number[]>([])
  const { controller, mode, reducedMotion, toggleMode } = useSceneTheme()
  const [status, setStatus] = useState<SceneStatus>(initialSceneStatus)
  const [attempt, setAttempt] = useState(0)
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mountRef.current) return
    setStatus(initialSceneStatus())
    try {
      stageRef.current = new Stage(mountRef.current, { reducedMotion, theme: controller, card: cardRef.current, onStatus: setStatus })
    } catch (failure) {
      setStatus({
        renderer: { state: 'error', message: `无法启动图形场景：${errorMessage(failure)}`, retryable: true },
        flowers: { state: 'degraded', message: '保留天空背景' },
        character: { state: 'degraded', message: '角色场景未启用，登录仍可用' },
      })
    }
    return () => {
      stageRef.current?.dispose()
      stageRef.current = null
    }
  }, [controller, reducedMotion, attempt])

  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  const resources = Object.entries(status)
  const pending = resources.some(([, resource]) => resource.state === 'loading')
  const retryable = resources.some(([, resource]) => resource.retryable)
  const complete = resources.every(([, resource]) => resource.state === 'ready')

  function retry() {
    if (status.renderer.state === 'error' || !stageRef.current) setAttempt(current => current + 1)
    else stageRef.current.retry()
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    const token = value.trim()
    if (!token) { setError('请输入 Panel Access Token'); return }
    if (token !== '123') { setError('密钥不正确（demo 密钥为 123）'); return }
    setLoading(true)
    setError(null)
    stageRef.current?.calmWind()
    if (!reducedMotion) timersRef.current.push(window.setTimeout(() => haloRef.current?.classList.add('play'), 350))
    timersRef.current.push(window.setTimeout(() => {
      sessionStorage.setItem(DEMO_TOKEN_KEY, '123')
      window.location.hash = '#/home'
    }, reducedMotion ? 0 : 1150))
  }

  return (
    <div className="login-page">
      <div ref={mountRef} className="stage-root" />
      <div className="login-layer">
        <form ref={cardRef} className="login-card" onSubmit={handleSubmit}>
          <div className="brand"><b>Elysia API</b><span>Console</span></div>
          <TokenLineInput value={value} onChange={next => { setValue(next); setError(null) }} />
          {error && <div className="error-tip" role="alert">{error}</div>}
          <ParticleButton loading={loading}>
            {loading ? '身份验证中…' : '立即登录'}
          </ParticleButton>
        </form>
      </div>
      <SealToggle night={mode === 'night'} onToggle={toggleMode} />
      {sequenceTool && <SequencePanel stageRef={stageRef} />}
      <div ref={haloRef} className="halo" aria-hidden />
      <details className={`scene-status ${retryable ? 'has-error' : ''}`} open={pending || retryable}>
        <summary aria-live="polite">{pending ? '场景加载中 · 登录可用' : complete ? '花海与爱莉希雅已就绪' : '场景部分可用 · 查看详情'}</summary>
        <ul>
          {resources.map(([name, resource]) => <li key={name} data-state={resource.state}>{resource.message}</li>)}
        </ul>
        {retryable && <button type="button" onClick={retry} disabled={pending}>重试场景资源</button>}
      </details>
    </div>
  )
}
