export type ResourceState = 'loading' | 'ready' | 'degraded' | 'error'
export type ResourceName = 'flowers' | 'renderer' | 'character'

export interface ResourceStatus {
  state: ResourceState
  message: string
  retryable?: boolean
}

export type SceneStatus = Record<ResourceName, ResourceStatus>

export function initialSceneStatus(): SceneStatus {
  return {
    renderer: { state: 'loading', message: '准备画布' },
    flowers: { state: 'loading', message: '加载三层花海' },
    character: { state: 'loading', message: '拼接爱莉希雅与风动发片' },
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function waitForResource<Value>(promise: Promise<Value>, signal: AbortSignal, release: (value: Value) => void): Promise<Value> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => fail(new Error('资源加载超时，请重试')), 30000)
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(new DOMException('场景已关闭', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(value => {
      if (settled) { release(value); return }
      settled = true
      cleanup()
      resolve(value)
    }, fail)
  })
}
