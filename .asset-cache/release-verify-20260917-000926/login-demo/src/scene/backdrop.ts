import * as THREE from 'three'
import type { ThemeSnapshot } from './daynight'
import type { WindField } from './windfield'
import { waitForResource } from './resources'
import { AlphaPyramid } from './coverage'
import type { Rect } from './character-manifest'

export interface FlowerLayerConfig {
  name: 'far' | 'mid' | 'front'
  shift: readonly [number, number]
  scale: number
  root: number
  tip: number
  amplitude: number
  frequency: number
  phase: number
}

export const FLOWER_CANVAS = { width: 3840, height: 2160 }

export const FLOWER_LAYERS: readonly FlowerLayerConfig[] = [
  { name: 'far', shift: [0, 0.14], scale: 1, root: 0.31, tip: 0.57, amplitude: 0.006, frequency: 1.0, phase: 0.4 },
  { name: 'mid', shift: [0, 0.24], scale: 1, root: 0.25, tip: 0.62, amplitude: 0.013, frequency: 1.45, phase: 1.8 },
  { name: 'front', shift: [0, 0.04], scale: 1, root: 0, tip: 0.48, amplitude: 0.022, frequency: 1.9, phase: 3.2 },
]

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = `
  uniform sampler2D uMap;
  uniform vec2 uCover;
  uniform vec2 uShift;
  uniform float uScale;
  uniform vec2 uRootTip;
  uniform vec3 uWave;
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec2 uPointer;
  uniform vec2 uWake;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec2 canvasUv = vUv * uCover + vec2((1.0 - uCover.x) * 0.5, 0.0);
    vec2 sampleUv = (canvasUv - 0.5 - uShift) / uScale + 0.5;
    float anchor = smoothstep(uRootTip.x, uRootTip.y, sampleUv.y);
    float edge = smoothstep(0.0, 0.025, sampleUv.x) * (1.0 - smoothstep(0.975, 1.0, sampleUv.x));
    float wave = 0.55 + 0.3 * sin(uTime * uWave.y + sampleUv.x * 19.0 + uWave.z)
                       + 0.15 * sin(uTime * uWave.y * 0.53 + sampleUv.y * 23.0 + uWave.z);
    vec2 toPointer = vUv - uPointer;
    float influence = exp(-dot(toPointer, toPointer) * 24.0);
    vec2 wind = uWind + uWake * influence;
    sampleUv -= wind * vec2(1.0, 0.25) * uWave.x * anchor * edge * wave;
    if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) discard;
    vec4 flower = texture2D(uMap, sampleUv);
    if (flower.a < 0.004) discard;
    gl_FragColor = vec4(flower.rgb * uTint, flower.a);
  }
`

export class FlowerLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private alpha: AlphaPyramid | null = null

  constructor(readonly config: FlowerLayerConfig, private texture: THREE.Texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: texture }, uCover: { value: new THREE.Vector2(1, 1) },
        uShift: { value: new THREE.Vector2(config.shift[0], -config.shift[1]) },
        uScale: { value: config.scale }, uRootTip: { value: new THREE.Vector2(config.root, config.tip) },
        uWave: { value: new THREE.Vector3(config.amplitude, config.frequency, config.phase) },
        uTime: { value: 0 }, uWind: { value: new THREE.Vector2() },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uWake: { value: new THREE.Vector2() },
        uTint: { value: new THREE.Color('white') },
      },
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.mesh.name = `flowers-${config.name}`
    this.mesh.renderOrder = config.name === 'front' ? 40 : config.name === 'mid' ? 10 : 0
    this.mesh.frustumCulled = false
    if (config.name !== 'far') this.readAlpha(texture.image as HTMLImageElement)
  }

  private readAlpha(image: HTMLImageElement) {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const alpha = new Uint8Array(canvas.width * canvas.height)
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3]
    this.alpha = new AlphaPyramid(canvas.width, canvas.height, alpha)
    canvas.width = 0
    canvas.height = 0
  }

  alphaIn(rect: Rect, width: number, height: number, safety: number, mode: 'minimum' | 'maximum') {
    if (!this.alpha || !this.mesh.visible) return 0
    const aspect = width / height
    const imageAspect = FLOWER_CANVAS.width / FLOWER_CANVAS.height
    const coverHorizontal = Math.min(1, aspect / imageAspect)
    const coverVertical = Math.min(1, imageAspect / aspect)
    const horizontal = (screen: number) => (screen / width * coverHorizontal + (1 - coverHorizontal) * 0.5 - 0.5 - this.config.shift[0]) / this.config.scale + 0.5
    const vertical = (screen: number) => ((1 - screen / height) * coverVertical - 0.5 + this.config.shift[1]) / this.config.scale + 0.5
    const upper = vertical(rect[1] - safety)
    const lower = vertical(rect[1] + rect[3] + safety)
    const anchor = THREE.MathUtils.smoothstep(upper, this.config.root, this.config.tip)
    const driftHorizontal = this.config.amplitude * 2.4 * anchor
    const driftVertical = this.config.amplitude * 0.375 * anchor
    const filterHorizontal = Math.max(1, FLOWER_CANVAS.width * coverHorizontal / width / this.config.scale)
    const filterVertical = Math.max(1, FLOWER_CANVAS.height * coverVertical / height / this.config.scale)
    return this.alpha.range(
      (horizontal(rect[0] - safety) - driftHorizontal) * FLOWER_CANVAS.width - filterHorizontal,
      (1 - upper - driftVertical) * FLOWER_CANVAS.height - filterVertical,
      (horizontal(rect[0] + rect[2] + safety) + driftHorizontal) * FLOWER_CANVAS.width + filterHorizontal,
      (1 - lower + driftVertical) * FLOWER_CANVAS.height + filterVertical,
      mode,
    )
  }

  resize(aspect: number) {
    const imageAspect = FLOWER_CANVAS.width / FLOWER_CANVAS.height
    const cover = this.mesh.material.uniforms.uCover.value as THREE.Vector2
    cover.set(Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect))
    this.mesh.scale.x = aspect
  }

  update(time: number, wind: WindField, theme: ThemeSnapshot, moving: boolean) {
    const uniforms = this.mesh.material.uniforms
    const ambient = moving ? wind.ambient() : { x: 0, y: 0 }
    uniforms.uTime.value = time
    uniforms.uWind.value.set(THREE.MathUtils.clamp(ambient.x, -1.2, 1.2), THREE.MathUtils.clamp(ambient.y, -0.3, 0.3))
    uniforms.uPointer.value.set(wind.pointer.x, wind.pointer.y)
    uniforms.uWake.value.set(moving ? wind.wake.x : 0, moving ? wind.wake.y : 0)
    uniforms.uTint.value.copy(theme.colors.flowers)
  }

  dispose() {
    this.alpha = null
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.texture.dispose()
  }
}

export async function loadFlower(config: FlowerLayerConfig, signal: AbortSignal) {
  const url = `${import.meta.env.BASE_URL}assets/scene/${config.name}.png`
  const texture = await waitForResource(new THREE.TextureLoader().loadAsync(url), signal, value => value.dispose())
  const image = texture.image as HTMLImageElement
  if (image.width !== FLOWER_CANVAS.width || image.height !== FLOWER_CANVAS.height) {
    texture.dispose()
    throw new Error(`${config.name}.png 必须保留 3840 × 2160 原始画布`)
  }
  return new FlowerLayer(config, texture)
}
