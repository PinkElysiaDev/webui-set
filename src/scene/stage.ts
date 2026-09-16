import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FLOWER_LAYERS, loadFlower, type FlowerLayer, type FlowerLayerConfig } from './backdrop'
import { loadCharacter, type CharacterRig } from './character'
import { DayNightController } from './daynight'
import { PetalLayer } from './petals'
import { Sky } from './sky'
import { WindField } from './windfield'
import { TouchEffect } from './touch-effect'
import { FlowerCoverage } from './coverage'
import { errorMessage, initialSceneStatus, type ResourceName, type ResourceStatus, type SceneStatus } from './resources'

export interface StageOptions {
  reducedMotion: boolean
  theme: DayNightController
  card: HTMLElement | null
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
  private character: CharacterRig | null = null
  private touch = new TouchEffect()
  private loadingFlowers = false
  private loadingCharacter = false
  private characterVisible = true
  private coverageCache: { key: string; field: FlowerCoverage } | null = null
  private characterResourceStatus: ResourceStatus = { state: 'loading', message: '准备角色素材' }
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
  /** 入场时序（秒）：前景大花 → 中景 → 人物 → 远景小花带 → 登录面板收尾 */
  private readonly revealSequence = { far: 2.4, mid: 1.2, character: 2.1, front: 0.3 }
  private cardRevealStart = 3.3
  private cardRevealed = false
  private revealTracks: { layer: FlowerLayer; start: number; duration: number }[] = []
  private characterReveal: { rig: CharacterRig; start: number; duration: number } | null = null
  private characterRevealDone = false
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
    this.foreground.add(this.touch.group)

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
    if (options.card) this.resizeObserver.observe(options.card)
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
          character: this.character?.snapshot() ?? null, contact: this.touch.snapshot(),
        }),
        motion: (enabled: boolean) => { this.motionEnabled = enabled; this.requestFrame() },
        petals: (visible: boolean) => { this.petals.mesh.visible = visible; this.requestFrame() },
        layer: (name: string, visible: boolean) => { const layer = this.flowers.get(name); if (layer) layer.mesh.visible = visible; this.layoutCharacter(); this.requestFrame() },
        character: (visible: boolean) => { this.characterVisible = visible; this.character?.setVisible(visible); this.requestFrame() },
        part: (name: string, visible: boolean) => { this.character?.showPart(name, visible); this.requestFrame() },
        contact: (visible: boolean) => { this.touch.enabled = visible; this.requestFrame() },
      } })
    }
    this.requestFrame()
  }

  retry() {
    if (this.disposed) return
    if (this.flowers.size < FLOWER_LAYERS.length && !this.loadingFlowers) void this.loadFlowers()
    if (!this.character?.animated && !this.loadingCharacter) void this.loadCharacter()
  }

  private async loadFlowers() {
    this.loadingFlowers = true
    this.report('flowers', { state: 'loading', message: '加载三层花海' })
    const results = await Promise.allSettled(FLOWER_LAYERS.filter(config => !this.flowers.has(config.name)).map(async config => {
      const layer = await loadFlower(config, this.abort.signal)
      if (this.disposed) { layer.dispose(); return }
      layer.setReveal(this.options.reducedMotion ? 1 : 0)
      this.flowers.set(config.name, layer)
      ;(config.name === 'far' ? this.background : this.foreground).add(layer.mesh)
      layer.resize(this.aspect)
      this.scheduleReveal(layer)
      this.layoutCharacter()
      this.requestFrame()
    }))
    this.loadingFlowers = false
    if (this.disposed) return
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    this.report('flowers', failures.length
      ? { state: 'error', message: `花海 ${this.flowers.size}/3 层可用：${errorMessage(failures[0].reason)}`, retryable: true }
      : { state: 'ready', message: '三层花海就绪' })
  }

  /**
   * 入场时序淡入：天空 → 花海1(far) → 花海2(mid) → 人物 → 花海3(front)。
   * 各元素按 revealSequence 的绝对时刻开始，1.4s 内 smoothstep 完成；
   * 花层在纹理加载完成即排队（开始时刻晚于加载完成时取加载时刻，避免跳变）。
   * 登录面板（DOM）按 cardRevealStart 由 container dataset 驱动 CSS 过渡。
   */
  private scheduleReveal(layer: FlowerLayer) {
    if (this.options.reducedMotion) { layer.setReveal(1); return }
    const start = Math.max(this.elapsed, this.revealSequence[layer.config.name])
    this.revealTracks.push({ layer, start, duration: 1.4 })
    this.requestFrame()
  }

  private scheduleCharacterReveal(rig: CharacterRig) {
    if (this.options.reducedMotion) { rig.setReveal(1); return }
    this.characterReveal = { rig, start: Math.max(this.elapsed, this.revealSequence.character), duration: 1.4 }
    this.requestFrame()
  }

  private updateReveal() {
    const active = this.revealTracks.length || this.characterReveal
    if (!active) return
    this.revealTracks = this.revealTracks.filter(track => {
      const progress = THREE.MathUtils.clamp((this.elapsed - track.start) / track.duration, 0, 1)
      const value = THREE.MathUtils.smoothstep(progress, 0, 1)
      if (track.layer.reveal < value) track.layer.setReveal(value)
      return progress < 1
    })
    if (this.characterReveal) {
      const track = this.characterReveal
      const progress = THREE.MathUtils.clamp((this.elapsed - track.start) / track.duration, 0, 1)
      const value = THREE.MathUtils.smoothstep(progress, 0, 1)
      if (!this.characterRevealDone) track.rig.setReveal(value)
      if (progress >= 1) { track.rig.setReveal(1); this.characterReveal = null; this.characterRevealDone = true }
    }
    if (this.revealTracks.length || this.characterReveal) this.requestFrame()
  }

  private async loadCharacter() {
    this.loadingCharacter = true
    this.report('character', { state: 'loading', message: '拼接爱莉希雅与风动发片' })
    try {
      const character = await loadCharacter(this.abort.signal)
      if (this.disposed) { character.dispose(); return }
      this.replaceCharacter(character)
      this.report('character', { state: 'ready', message: '爱莉希雅 · 风动发片、头纱与花间星屑就绪' })
    } catch (failure) {
      if (this.disposed) return
      if (!this.character) {
        try {
          const fallback = await loadCharacter(this.abort.signal, true)
          if (this.disposed) { fallback.dispose(); return }
          this.replaceCharacter(fallback)
        } catch {
          if (this.disposed) return
        }
      }
      this.report('character', {
        state: this.character ? 'degraded' : 'error', retryable: true,
        message: `${this.character ? '保留静态爱莉希雅' : '角色暂不可用，登录不受影响'}：${errorMessage(failure)}`,
      })
    } finally {
      this.loadingCharacter = false
      this.requestFrame()
    }
  }

  private replaceCharacter(character: CharacterRig) {
    this.character?.dispose()
    this.character = character
    character.setVisible(this.characterVisible)
    if (this.characterRevealDone) character.setReveal(1)
    else this.scheduleCharacterReveal(character)
    this.foreground.add(character.group)
    this.layoutCharacter()
    this.requestFrame()
  }

  private layoutCharacter() {
    if (!this.character) return
    const bounds = this.container.getBoundingClientRect()
    const card = this.options.card?.getBoundingClientRect()
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    const sources = ['mid', 'front'].map(name => this.flowers.get(name)).filter((layer): layer is FlowerLayer => !!layer?.mesh.visible)
    const { minimumCoverage, safetyPixels } = this.character.requirements
    const key = `${width}:${height}:${minimumCoverage}:${safetyPixels}:${sources.map(layer => layer.config.name).join(',')}`
    if (!this.coverageCache || this.coverageCache.key !== key) {
      this.coverageCache = { key, field: new FlowerCoverage(width, height, minimumCoverage, safetyPixels, sources) }
    }
    this.character.resize({
      width, height,
      card: card ? { left: card.left - bounds.left, right: card.right - bounds.left, top: card.top - bounds.top, bottom: card.bottom - bounds.top } : undefined,
      coverage: this.coverageCache.field,
    })
    this.report('character', this.characterResourceStatus)
  }

  private report(name: ResourceName, status: ResourceStatus) {
    if (this.disposed) return
    if (name === 'character') {
      this.characterResourceStatus = status
      if (status.state !== 'loading' && this.character && !this.character.coverageSatisfied) {
        status = { ...status, state: 'degraded', message: `角色暂隐藏，登录可用：${this.character.hiddenReason}${status.retryable ? `；${status.message}` : ''}` }
      }
    }
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
    this.layoutCharacter()
    this.touch.resize(width, height)
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

  /** 调试：运行时改入场时序并整段重放（?sequence 面板用） */
  replaySequence(sequence: { far: number; mid: number; character: number; front: number }) {
    this.revealSequence.far = sequence.far
    this.revealSequence.mid = sequence.mid
    this.revealSequence.character = sequence.character
    this.revealSequence.front = sequence.front
    this.revealTracks = []
    this.characterReveal = null
    this.characterRevealDone = false
    this.flowers.forEach(layer => layer.setReveal(0))
    this.character?.setReveal(0)
    const base = this.elapsed
    FLOWER_LAYERS.forEach(config => {
      const layer = this.flowers.get(config.name)
      if (layer) this.revealTracks.push({ layer, start: base + sequence[config.name], duration: 1.4 })
    })
    if (this.character) this.scheduleCharacterReveal(this.character)
    this.cardRevealStart = base + Math.max(sequence.far, sequence.mid, sequence.character, sequence.front) + 0.9
    this.cardRevealed = false
    this.requestFrame()
  }

  /** 登录面板最后显现：到点后给容器打 dataset 标记，CSS 过渡接手 */
  private updateCardReveal() {
    if (this.cardRevealed || this.disposed) return
    if (this.options.reducedMotion || this.elapsed >= this.cardRevealStart) {
      this.cardRevealed = true
      this.container.dataset.cardReady = 'true'
    }
  }

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
    this.updateReveal()
    this.updateCardReveal()
    const theme = this.options.theme.snapshot
    this.bloom.strength = theme.bloom
    this.sky.update(this.elapsed, theme)
    this.flowers.forEach(layer => layer.update(this.elapsed, this.wind, theme, moving))
    this.character?.update(motionDelta, this.elapsed, this.wind, theme, moving)
    const contact = this.flowers.get('front')?.mesh.visible ? this.character?.contact() ?? null : null
    this.touch.update(motionDelta, this.elapsed, contact, this.wind, theme, moving, this.lowQuality)
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
    this.flowers.clear()
    this.coverageCache = null
    this.character?.dispose()
    this.touch.dispose()
    this.sky.dispose()
    this.petals.dispose()
    this.composer.passes.forEach(pass => pass.dispose())
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    if (this.inspectEnabled) Reflect.deleteProperty(window, '__loginDemo')
  }
}
