import { useEffect, useState } from 'react'
import { LoginPage } from '../ui/LoginPage'
import { HomePage } from '../ui/HomePage'

/** 极简 hash 路由：#/login（默认）与 #/home（需 sessionStorage 密钥） */
export function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/login')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/login')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export const DEMO_TOKEN_KEY = 'demo-token'

export function App() {
  const route = useHashRoute()

  if (route.startsWith('#/home')) {
    const token = sessionStorage.getItem(DEMO_TOKEN_KEY)
    if (token === '123') return <HomePage />
    window.location.hash = '#/login'
  }
  return <LoginPage />
}
