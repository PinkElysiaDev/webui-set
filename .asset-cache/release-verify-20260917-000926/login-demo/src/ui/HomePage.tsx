import { DEMO_TOKEN_KEY } from '../app/App'

/** 固定首页：静态展示 + 返回登录 */
export function HomePage() {
  return (
    <div className="home">
      <h1>欢迎回来</h1>
      <p>登录展示 demo · 固定首页占位</p>
      <button
        type="button"
        onClick={() => {
          sessionStorage.removeItem(DEMO_TOKEN_KEY)
          window.location.hash = '#/login'
        }}
      >
        返回登录
      </button>
    </div>
  )
}
