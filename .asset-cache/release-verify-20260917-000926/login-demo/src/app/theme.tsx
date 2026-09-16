import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { applyTheme, DayNightController, type ThemeMode } from '../scene/daynight'

interface SceneTheme {
  controller: DayNightController
  mode: ThemeMode
  reducedMotion: boolean
  toggleMode(): void
}

const ThemeContext = createContext<SceneTheme | null>(null)

function savedMode(): ThemeMode {
  try {
    return sessionStorage.getItem('demo-theme') === 'night' ? 'night' : 'day'
  } catch {
    return 'day'
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(savedMode)
  const [controller] = useState(() => new DayNightController(mode))
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('theme-night', mode === 'night')
    try { sessionStorage.setItem('demo-theme', mode) } catch {}
    const unsubscribe = controller.subscribe(() => applyTheme(controller.snapshot))
    controller.setMode(mode, reducedMotion)
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      controller.update(Math.min((now - last) / 1000, 0.1))
      last = now
      if (!controller.settled) frame = requestAnimationFrame(tick)
    }
    if (!controller.settled) frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [controller, mode, reducedMotion])

  return (
    <ThemeContext.Provider value={{ controller, mode, reducedMotion, toggleMode: () => setMode(current => current === 'day' ? 'night' : 'day') }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useSceneTheme() {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('Scene theme is unavailable')
  return theme
}
