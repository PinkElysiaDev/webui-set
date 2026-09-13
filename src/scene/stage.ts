import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { Backdrop } from './backdrop'
import { DayNightController } from './daynight'
import { PetalLayer } from './petals'
import { WindField } from './windfield'
import { loadCharacter, type CharacterHandles } from './character'

/**
 * 场景编排：渲染器 / 相机 / 灯光组 / 后处理 / 背景板 / 花瓣 / 角色 / 主循环。
 * 相机固定朝 -Z（无旋转），构图：角色居右、表单（DOM）居左。
 */
const CHARACTER_URL = `${import.meta.env.BASE_URL}assets/model/爱莉希雅 3.0.pmx`
const MODEL_PATH = `${import.meta.env.BASE_URL}assets/model/`
const BACKDROP_URL = `${import.meta.env.BASE_URL}assets/backdrop.png`
/** 花瓣层在相机前方 18 单位处（相机空间 z=-18） */
const PETAL_DISTANCE = 18

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uMul: { value: new THREE.Color(1, 1, 1) },
    uAdd: { value: new THREE.Color(0, 0, 0) },
    uVignette: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uMul;
    uniform vec3 uAdd;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      color.rgb = color.rgb * uMul + uAdd;
      float d = distance(vUv, vec2(0.5));
      color.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = color;
    }
  `,
}

export interface StageOptions {
  reducedMotion: boolean
  onProgress?: (ratio: number, label: string) => void
}

export class Stage {
  readonly wind = new WindField()
  readonly dayNight = new DayNightController()
  setHappyMood = () => {}

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private gradePass: ShaderPass
  private keyLight = new THREE.DirectionalLight(0xffffff, 1)
  private fillLight = new THREE.DirectionalLight(0xffffff, 0.5)
  private rimLight = new THREE.DirectionalLight(0xffffff, 0.5)
  private hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 0.6)
  private petals: PetalLayer
  private backdrop: Backdrop
  private character: CharacterHandles | null = null
  private cameraLayer = new THREE.Group()
  private raf = 0
  private clock = new THREE.Clock()
  private elapsed = 0
  private pointer = { x: 0.5, y: 0.5 }
  private lastPointer = { x: 0.5, y: 0.5 }
  private container: HTMLElement
  private reducedMotion: boolean
  private disposed = false
  private calmTimer = -1

  constructor(container: HTMLElement, options: StageOptions) {
    this.container = container
    this.reducedMotion = options.reducedMotion
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    container.appendChild(this.renderer.domElement)

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 200)
    this.camera.position.set(0, 13.5, 38)
    this.camera.lookAt(0, 12, 0)

    // 灯光组
    this.keyLight.position.set(6, 18, 14)
    this.fillLight.position.set(-10, 8, 12)
    this.rimLight.position.set(-4, 16, -18)
    this.scene.add(this.keyLight, this.fillLight, this.rimLight, this.hemi)

    // 相机挂载层（花瓣 + 背景板，屏幕平行）
    this.camera.add(this.cameraLayer)
    this.scene.add(this.camera)

    // 后处理
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.32,
      0.6,
      0.85,
    )
    this.composer.addPass(this.bloom)
    this.gradePass = new ShaderPass(GRADE_SHADER)
    this.composer.addPass(this.gradePass)

    // 花瓣
    this.petals = new PetalLayer(window.innerWidth < 768 ? 60 : 160)
    this.petals.mesh.position.z = -18
    this.cameraLayer.add(this.petals.mesh)

    // 背景板
    const backdropTexture = new THREE.TextureLoader().load(BACKDROP_URL)
    this.backdrop = new Backdrop(backdropTexture)
    this.backdrop.mesh.position.z = -40
    this.cameraLayer.add(this.backdrop.mesh)

    this.resize()
    window.addEventListener('resize', this.resize)
    container.addEventListener('pointermove', this.onPointerMove)

    void this.loadContents(options.onProgress)
  }

  private async loadContents(onProgress?: (r: number, label: string) => void) {
    onProgress?.(0.15, '加载花海背景')
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = BACKDROP_URL
    })
    onProgress?.(0.3, '加载角色模型')
    try {
      this.character = await loadCharacter(encodeURI(CHARACTER_URL), encodeURI(MODEL_PATH))
      const mesh = this.character.mesh
      // 底对齐 + 居右
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox!
      mesh.position.y -= box.min.y
      mesh.position.x = 7.2
      mesh.rotation.y = THREE.MathUtils.degToRad(-12) // 微面向左侧表单
      this.scene.add(mesh)
      this.setHappyMood = this.character.setHappy
      // 角色就位后再预热一轮（摆位后发丝姿态重置）
      for (let i = 0; i < 60; i += 1) {
        this.character.update(1 / 60, i / 60, this.camera, this.wind, this.pointer)
      }
    } catch (error) {
      console.error('[stage] 角色加载失败，场景退化为背景 + 花瓣', error)
    }
    void image
    onProgress?.(1, '就绪')

    if (this.reducedMotion) {
      this.renderFrame(0.016) // 静帧
    } else {
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.container.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = 1 - (event.clientY - rect.top) / rect.height
    this.wind.pushPointer(x, y, x - this.lastPointer.x, y - this.lastPointer.y)
    this.lastPointer = { x, y }
    this.pointer = { x, y }
  }

  private resize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // 背景板 cover（花海图 16:9 约定，按实际图片比例）；面片高度 = 视锥高 × 1.15
    const frustumHeight = 2 * PETAL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.backdrop.setAspect(this.camera.aspect, frustumHeight * 2.2 * 1.15, 16 / 9)
  }

  /** 登录成功：风息（calm → 0） */
  calmWind() {
    this.calmTimer = 0
  }

  private renderFrame(dt: number) {
    this.elapsed += dt
    const snap = this.dayNight.snapshot

    // 风息过渡
    if (this.calmTimer >= 0) {
      this.calmTimer = Math.min(this.calmTimer + dt, 0.6)
      this.wind.calm = 1 - easeInOut(this.calmTimer / 0.6)
    }

    this.wind.update(dt)
    this.dayNight.update(dt)

    // 灯光
    this.keyLight.color.copy(snap.key.color)
    this.keyLight.intensity = snap.key.intensity
    this.fillLight.color.copy(snap.fill.color)
    this.fillLight.intensity = snap.fill.intensity
    this.rimLight.color.copy(snap.rim.color)
    this.rimLight.intensity = snap.rim.intensity
    this.hemi.color.copy(snap.hemi.skyColor)
    this.hemi.groundColor.copy(snap.hemi.groundColor)
    this.hemi.intensity = snap.hemi.intensity
    this.bloom.strength = snap.bloom
    this.gradePass.uniforms.uMul.value.copy(snap.gradeMul)
    this.gradePass.uniforms.uAdd.value.copy(snap.gradeAdd)

    // 背景 / 花瓣 / 角色
    const windSample = this.wind.sample(0.5, 0.5)
    this.backdrop.update(
      this.elapsed,
      windSample.x,
      windSample.y,
      snap.backdropMul,
      snap.backdropAdd,
      snap.stars,
    )
    this.petals.setNight(snap.stars)
    const petalHalfH = PETAL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.petals.update(dt, this.wind, petalHalfH * this.camera.aspect, petalHalfH)
    this.character?.update(dt, this.elapsed, this.camera, this.wind, this.pointer)

    this.composer.render()
  }

  private loop = () => {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 1 / 20)
    this.renderFrame(dt)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
