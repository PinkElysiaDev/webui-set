import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FLOWER_LAYERS, loadFlower, type FlowerLayer } from './backdrop'
import { DayNightController } from './daynight'
import { PetalLayer } from './petals'
import { Sky } from './sky'
import { WindField } from './windfield'
import { errorMessage, initialSceneStatus, type ResourceName, type ResourceStatus, type SceneStatus } from './resources'

export interface StageOptions {
  reducedMotion: boolean
  theme: DayNightController
  onStatus(status: SceneStatus): void
}

export class Stage {
  private wind = new WindField()
  private renderer: THREE.WebGLRenderer
  private background = new THREE.Scene()
  private foreground = new THREE.Scene()
  private screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private sky = new Sky()
  private petals: PetalLayer
  private flowers = new Map<string, FlowerLayer>()
  private abort = new AbortController()
  private status = initialSceneStatus()
  private unsubscribe: () => void
  private resizeObserver: ResizeObserver
  private raf = 0
  private lastTime = 0
  private elapsed = 0
  private slowTime = 0
  private lowQuality = false
  private disposed = false
  private lost = false
  private calmTime = -1
  private pointer: { x: number; y: number } | null = null
  private motionEnabled = true
  private aspect = 1
  private inspectEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has('inspect')

  constructor(private container: HTMLElement, private options: StageOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setClearColor(options.theme.snapshot.colors.skyTop, 1)
    this.renderer.info.autoReset = false
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.screenCamera.position.z = 2
    this.background.add(this.sky.mesh)
    this.petals = new PetalLayer(container.clientWidth < 768 ? 48 : 110)
    this.foreground.add(this.petals.mesh)

    this.composer = new EffectComposer(this.renderer)
    const backgroundPass = new RenderPass(this.background, this.screenCamera)
    const foregroundPass = new RenderPass(this.foreground, this.screenCamera)
    foregroundPass.clear = false
    foregroundPass.clearDepth = true
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 1.1)
    this.composer.addPass(backgroundPass)
    this.composer.addPass(foregroundPass)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.unsubscribe = options.theme.subscribe(this.requestFrame)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    this.resize()
    container.addEventListener('pointermove', this.onPointerMove)
    container.addEventListener('pointerleave', this.onPointerLeave)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
    this.report('renderer', { state: 'ready', message: '画布就绪' })
    this.render(0)
    this.retry()
    if (this.inspectEnabled) {
      Object.defineProperty(window, '__loginDemo', { configurable: true, value: {
        snapshot: () => ({
          status: this.status, elapsed: this.elapsed, quality: this.lowQuality ? 'economy' : 'full',
          drawCalls: this.renderer.info.render.calls, memory: this.renderer.info.memory,
          flowers: [...this.flowers.values()].map(layer => ({ ...layer.config })),
        }),
        motion: (enabled: boolean) => { this.motionEnabled = enabled; this.requestFrame() },
        petals: (visible: boolean) => { this.petals.mesh.visible = visible; this.requestFrame() },
        layer: (name: string, visible: boolean) => { const layer = this.flowers.get(name); if (layer) layer.mesh.visible = visible; this.requestFrame() },
      } })
    }
    this.requestFrame()
  }

  retry() {
    if (this.disposed) return
    if (this.flowers.size < FLOWER_LAYERS.length) void this.loadFlowers()
  }

  private async loadFlowers() {
    this.report('flowers', { state: 'loading', message: '加载三层花海' })
    const results = await Promise.allSettled(FLOWER_LAYERS.filter(config => !this.flowers.has(config.name)).map(async config => {
      const layer = await loadFlower(config, this.abort.signal)
      if (this.disposed) { layer.dispose(); return }
      this.flowers.set(config.name, layer)
      ;(config.name === 'far' ? this.background : this.foreground).add(layer.mesh)
      layer.resize(this.aspect)
      this.requestFrame()
    }))
    if (this.disposed) return
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    this.report('flowers', failures.length
      ? { state: 'error', message: `花海 ${this.flowers.size}/3 层可用：${errorMessage(failures[0].reason)}`, retryable: true }
      : { state: 'ready', message: '三层花海就绪' })
  }

  private report(name: ResourceName, status: ResourceStatus) {
    if (this.disposed) return
    this.status = { ...this.status, [name]: status }
    this.container.dataset[name] = status.state
    this.options.onStatus(this.status)
  }

  private resize = () => {
    if (this.disposed) return
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (!width || !height) return
    const aspect = width / height
    this.aspect = aspect
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.screenCamera.left = -aspect
    this.screenCamera.right = aspect
    this.screenCamera.updateProjectionMatrix()
    this.sky.resize(aspect)
    this.flowers.forEach(layer => layer.resize(aspect))
    this.requestFrame()
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.options.reducedMotion || event.pointerType === 'touch') return
    const bounds = this.container.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width
    const y = 1 - (event.clientY - bounds.top) / bounds.height
    if (this.pointer) this.wind.pushPointer(x, y, x - this.pointer.x, y - this.pointer.y)
    this.pointer = { x, y }
  }

  private onPointerLeave = () => { this.pointer = null }

  calmWind() { this.calmTime = 0 }

  private render(delta: number) {
    if (this.disposed || this.lost) return
    const moving = !this.options.reducedMotion && this.motionEnabled
    const motionDelta = moving ? delta : 0
    this.elapsed += motionDelta
    if (this.calmTime >= 0) {
      this.calmTime = Math.min(0.6, this.calmTime + delta)
      this.wind.calm = 1 - THREE.MathUtils.smoothstep(this.calmTime, 0, 0.6)
    }
    this.wind.update(motionDelta)
    const theme = this.options.theme.snapshot
    this.bloom.strength = theme.bloom
    this.sky.update(this.elapsed, theme)
    this.flowers.forEach(layer => layer.update(this.elapsed, this.wind, theme, moving))
    this.petals.update(motionDelta, this.elapsed, this.wind, this.aspect, theme, this.lowQuality)
    this.renderer.info.reset()
    this.composer.render()
  }

  private requestFrame = () => {
    if (!this.raf && !this.disposed && !this.lost && !document.hidden) this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (now: number) => {
    this.raf = 0
    const rawDelta = this.lastTime ? (now - this.lastTime) / 1000 : 0
    this.lastTime = now
    if (!this.options.reducedMotion && this.motionEnabled) {
      this.slowTime = rawDelta > 1 / 43 && rawDelta < 0.2 ? this.slowTime + rawDelta : Math.max(0, this.slowTime - rawDelta)
      if (!this.lowQuality && this.slowTime > 3) {
        this.lowQuality = true
        this.renderer.setPixelRatio(1)
        this.composer.setPixelRatio(1)
        this.bloom.enabled = false
        this.resize()
      }
    }
    this.render(Math.min(rawDelta, 0.05))
    if (!this.options.reducedMotion && this.motionEnabled) this.requestFrame()
    else this.lastTime = 0
  }

  private onVisibility = () => {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.lastTime = 0
    if (!document.hidden) this.requestFrame()
  }

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.lost = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.report('renderer', { state: 'error', message: '图形上下文丢失，请重试场景', retryable: true })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    cancelAnimationFrame(this.raf)
    this.unsubscribe()
    this.resizeObserver.disconnect()
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerleave', this.onPointerLeave)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.flowers.forEach(layer => layer.dispose())
    this.sky.dispose()
    this.petals.dispose()
    this.composer.passes.forEach(pass => pass.dispose())
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    if (this.inspectEnabled) Reflect.deleteProperty(window, '__loginDemo')
  }
}
