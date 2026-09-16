import * as THREE from 'three'
import type { ThemeSnapshot } from './daynight'
import type { WindField } from './windfield'
import { waitForResource } from './resources'
import { validateManifest, type CharacterLayerSpec, type CharacterManifest } from './character-manifest'
import { placeCharacter, screenRect, type CharacterViewport } from './character-placement'

export interface ContactAnchor {
  horizontal: number
  vertical: number
  scale: number
  visible: boolean
}

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/character/`
const WHITE = new THREE.Color('white')
const MOONLIGHT = new THREE.Color('#bcb6e3')

const VERTEX = `
  attribute float aProgress;
  attribute float aWeight;
  attribute float aPhase;
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uFrequency;
  uniform float uPhase;
  uniform vec2 uWind;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 displaced = position;
    float travel = uTime * uFrequency - aProgress * 4.8 + uPhase + aPhase;
    float wave = sin(travel) * 0.72 + sin(travel * 1.71 + aPhase * 0.4) * 0.22;
    float strength = min(length(uWind), 1.2);
    displaced.x += uAmplitude * aWeight * uWind.x * (0.21 + wave * 0.16);
    displaced.y += uAmplitude * aWeight * strength * wave;
    displaced.y += uAmplitude * aWeight * uWind.y * 0.25;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const FRAGMENT = `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform float uReveal;
  varying vec2 vUv;
  void main() {
    vec4 pigment = texture2D(uMap, vUv);
    if (pigment.a < 0.004) discard;
    gl_FragColor = vec4(pigment.rgb * uTint, pigment.a * uReveal);
  }
`

export class CharacterRig {
  readonly group = new THREE.Group()
  private layers: { spec: CharacterLayerSpec; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; texture: THREE.Texture }[] = []
  private placement = { horizontal: 0, vertical: 0, scale: 1 }
  private viewport: CharacterViewport | null = null
  private flow = new THREE.Vector2()
  private contactAllowed = false
  private contactPoint: { horizontal: number; vertical: number } | null = null
  private occlusion: ReturnType<typeof placeCharacter>['occlusion'] | null = null
  private requestedVisible = true
  private tinted = new THREE.Color()

  constructor(private manifest: CharacterManifest, textures: THREE.Texture[], readonly animated: boolean) {
    this.group.name = animated ? 'elysia-character' : 'elysia-static'
    try {
      manifest.layers.forEach((spec, index) => {
        const texture = textures[index]
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 2
        const geometry = createGeometry(spec)
        const material = new THREE.ShaderMaterial({
          vertexShader: VERTEX, fragmentShader: FRAGMENT,
          transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
          uniforms: {
            uMap: { value: texture }, uTint: { value: new THREE.Color('white') },
            uTime: { value: 0 }, uWind: { value: new THREE.Vector2() },
            uReveal: { value: 0 },
            uAmplitude: { value: spec.amplitude }, uFrequency: { value: spec.frequency }, uPhase: { value: spec.phase },
          },
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `character-${spec.id}`
        mesh.renderOrder = 1 + index / manifest.layers.length * 8
        mesh.frustumCulled = false
        this.layers.push({ spec, mesh, texture })
        this.group.add(mesh)
      })
    } catch (failure) {
      this.dispose()
      textures.forEach(texture => texture.dispose())
      throw failure
    }
  }

  resize(viewport: CharacterViewport) {
    this.viewport = viewport
    const { width, height } = viewport
    const result = placeCharacter(this.manifest, viewport)
    this.placement = result.placement
    this.occlusion = result.occlusion
    const { horizontal, vertical, scale } = this.placement
    this.group.position.set((horizontal - width / 2) * 2 / height, (height / 2 - vertical) * 2 / height, 0)
    this.group.scale.setScalar(scale * 2 / height)
    this.setVisible(this.requestedVisible)
    this.locateContact()
  }

  get requirements() { return this.manifest.occlusion }
  get coverageSatisfied() { return this.occlusion?.satisfied ?? false }
  get hiddenReason() { return this.occlusion?.reason ?? '正在计算花层覆盖' }

  setReveal(value: number) {
    for (const { mesh } of this.layers) mesh.material.uniforms.uReveal.value = value
  }

  setVisible(visible: boolean) {
    this.requestedVisible = visible
    this.group.visible = visible && this.coverageSatisfied
  }

  private locateContact() {
    this.contactPoint = null
    this.contactAllowed = false
    if (!this.viewport || !this.coverageSatisfied) return
    const { coverage, width, height, card } = this.viewport
    const hand = this.anchor('hand')
    const fingertip = this.anchor('fingertip')
    const horizontal = (hand.horizontal + fingertip.horizontal) / 2
    if (horizontal < 24 || horizontal > width - 24 || hand.vertical > height - 24) return
    for (let vertical = hand.vertical; vertical >= hand.vertical - 90 * this.placement.scale; vertical -= 2) {
      if (!coverage.covers([[horizontal - 8, vertical, 16, 4]]) || coverage.covers([[horizontal - 8, vertical - 4, 16, 4]])) continue
      if (card && horizontal > card.left - 24 && horizontal < card.right + 24 && vertical > card.top - 24 && vertical < card.bottom + 24) return
      this.contactPoint = { horizontal, vertical }
      this.contactAllowed = vertical > 24 && vertical < height - 24
      return
    }
  }

  update(delta: number, time: number, wind: WindField, theme: ThemeSnapshot, moving: boolean) {
    const head = this.anchor('head')
    const ambient = wind.ambient()
    const sample = this.viewport ? wind.sample(head.horizontal / this.viewport.width, 1 - head.vertical / this.viewport.height) : ambient
    const horizontal = ambient.x + THREE.MathUtils.clamp(sample.x - ambient.x, -0.22, 0.22)
    const vertical = ambient.y + THREE.MathUtils.clamp(sample.y - ambient.y, -0.16, 0.16)
    if (moving) {
      this.flow.x = THREE.MathUtils.damp(this.flow.x, horizontal, 3, delta)
      this.flow.y = THREE.MathUtils.damp(this.flow.y, vertical, 3, delta)
    } else this.flow.set(0, 0)
    this.tinted.copy(WHITE).lerp(MOONLIGHT, theme.blend)
    for (const { mesh } of this.layers) {
      mesh.material.uniforms.uTime.value = time
      mesh.material.uniforms.uWind.value.copy(this.flow)
      mesh.material.uniforms.uTint.value.copy(this.tinted)
    }
  }

  anchor(name: keyof CharacterManifest['anchors']) {
    const anchor = this.manifest.anchors[name]
    return {
      horizontal: this.placement.horizontal + anchor[0] * this.placement.scale,
      vertical: this.placement.vertical + anchor[1] * this.placement.scale,
    }
  }

  contact(): ContactAnchor {
    const point = this.contactPoint ?? this.anchor('hand')
    return { ...point, scale: this.placement.scale, visible: this.animated && this.group.visible && this.contactAllowed }
  }

  showPart(name: string, visible: boolean) {
    const layer = this.layers.find(entry => entry.spec.id === name)
    if (layer) layer.mesh.visible = visible
  }

  snapshot() {
    return {
      animated: this.animated, visible: this.group.visible, placement: { ...this.placement },
      anchors: { head: this.anchor('head'), face: this.anchor('face'), hand: this.anchor('hand'), hairRoot: this.anchor('hairRoot'), fingertip: this.anchor('fingertip') },
      occlusion: this.occlusion,
      faceBounds: screenRect(this.manifest.faceBounds, this.placement),
      requiredRegions: this.manifest.occlusion.regions.map(region => ({ id: region.id, rects: region.rects.map(rect => screenRect(rect, this.placement)) })),
      contactVisible: this.contact().visible,
      layers: this.layers.map(({ spec, mesh }) => {
        const positions = mesh.geometry.getAttribute('position')
        const weights = mesh.geometry.getAttribute('aWeight')
        let maximumWeight = 0
        let pinnedMaximumWeight = 0
        for (let index = 0; index < weights.count; index += 1) {
          maximumWeight = Math.max(maximumWeight, weights.getX(index))
          if (Math.hypot(positions.getX(index) - spec.root[0], -positions.getY(index) - spec.root[1]) <= spec.pin[0]) pinnedMaximumWeight = Math.max(pinnedMaximumWeight, weights.getX(index))
        }
        return { id: spec.id, source: spec.source, registration: spec.registration, motion: spec.motion, root: spec.root, tip: spec.tip, pin: spec.pin, visible: mesh.visible, texture: spec.size, maximumWeight, pinnedMaximumWeight }
      }),
    }
  }

  dispose() {
    this.group.removeFromParent()
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose()
      layer.mesh.material.dispose()
      layer.texture.dispose()
    }
    this.layers = []
    this.group.clear()
  }
}

function createGeometry(spec: CharacterLayerSpec) {
  const [left, top, width, height] = spec.rect
  const deforming = spec.motion !== 'fixed'
  const columns = deforming ? Math.max(12, Math.ceil(width / 25)) : 1
  const rows = deforming ? Math.max(10, Math.ceil(height / 22)) : 1
  const geometry = new THREE.PlaneGeometry(width, height, columns, rows)
  const positions = geometry.getAttribute('position')
  const coordinates = geometry.getAttribute('uv')
  const progress = new Float32Array(positions.count)
  const weights = new Float32Array(positions.count)
  const phases = new Float32Array(positions.count)
  for (let index = 0; index < positions.count; index += 1) {
    const horizontal = left + coordinates.getX(index) * width
    const vertical = top + (1 - coordinates.getY(index)) * height
    positions.setXYZ(index, horizontal, -vertical, 0)
    const directionHorizontal = spec.tip[0] - spec.root[0]
    const directionVertical = spec.tip[1] - spec.root[1]
    const lengthSquared = directionHorizontal ** 2 + directionVertical ** 2
    const distance = lengthSquared ? ((horizontal - spec.root[0]) * directionHorizontal + (vertical - spec.root[1]) * directionVertical) / lengthSquared : 0
    progress[index] = THREE.MathUtils.clamp(distance, 0, 1)
    const rootDistance = Math.hypot(horizontal - spec.root[0], vertical - spec.root[1])
    weights[index] = deforming ? THREE.MathUtils.smoothstep(progress[index], 0.13, 0.95)
      * THREE.MathUtils.smoothstep(rootDistance, spec.pin[0], spec.pin[1]) : 0
    phases[index] = progress[index] * 3.2
  }
  geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1))
  geometry.setAttribute('aWeight', new THREE.BufferAttribute(weights, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.computeBoundingSphere()
  return geometry
}

export async function loadCharacter(signal: AbortSignal, fallback = false) {
  const manifest = validateManifest(await waitForResource(
    fetch(`${ASSET_ROOT}${fallback ? 'fallback' : 'manifest'}.json`, { signal }).then(response => {
      if (!response.ok) throw new Error(`角色配置加载失败 (${response.status})`)
      return response.json() as Promise<unknown>
    }), signal, () => {},
  ), fallback)
  const results = await Promise.allSettled(manifest.layers.map(async spec => {
    const texture = await waitForResource(new THREE.TextureLoader().loadAsync(`${ASSET_ROOT}${spec.file}`), signal, value => value.dispose())
    const image = texture.image as HTMLImageElement
    if (image.width !== spec.size[0] || image.height !== spec.size[1]) {
      texture.dispose()
      throw new Error(`${spec.file} 尺寸与配准数据不匹配`)
    }
    return texture
  }))
  const textures = results.filter((result): result is PromiseFulfilledResult<THREE.Texture> => result.status === 'fulfilled').map(result => result.value)
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure || signal.aborted) {
    textures.forEach(texture => texture.dispose())
    throw failure?.reason ?? new DOMException('场景已关闭', 'AbortError')
  }
  return new CharacterRig(manifest, textures, !fallback)
}
