import * as THREE from 'three'
import type { ThemeSnapshot } from './daynight'

export class Sky {
  readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uNight: { value: 0 }, uTime: { value: 0 },
      uAspect: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform float uNight;
      uniform float uTime;
      uniform float uAspect;
      void main() {
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.28, 1.0, vUv.y)), 1.0);
      }
    `,
  }))

  constructor() {
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
  }

  resize(aspect: number) {
    this.mesh.scale.x = aspect
    this.mesh.material.uniforms.uAspect.value = aspect
  }

  update(time: number, theme: ThemeSnapshot) {
    const uniforms = this.mesh.material.uniforms
    uniforms.uTop.value.copy(theme.colors.skyTop)
    uniforms.uHorizon.value.copy(theme.colors.skyHorizon)
    uniforms.uNight.value = theme.blend
    uniforms.uTime.value = time
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

interface StarState {
  active: boolean
  entered: boolean
  angle: number
  radius: number
  speed: number
  alpha: number
}

/**
 * 星轨式方片星星：绕同一「天极」缓缓做圆弧运动（方向一致如长曝光星轨）。
 * 生成率随时间准周期起伏（时多时少）；**从屏幕外生成、驶入视野，再次
 * 离开屏幕即回收**。纯白方片、普通半透明混合（不发光），透明度逐星随机
 * 固定形成明暗不均；夜间随主题 blend 渐显。
 */
export class StarField {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private states: StarState[] = []
  private positions: Float32Array
  private alphas: Float32Array
  private sizes: Float32Array
  private time = 0
  private pole = new THREE.Vector2(0.6, 0.4)
  private aspect = 1

  constructor(private max = 14) {
    this.positions = new Float32Array(max * 3)
    this.alphas = new Float32Array(max)
    this.sizes = new Float32Array(max)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: { uNight: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uNight;
        varying float vAlpha;
        void main() {
          // 普通半透明白色方片：无 HDR 亮度、不加色混合，不产生辉光
          gl_FragColor = vec4(vec3(0.92, 0.94, 1.0), vAlpha * uNight);
        }
      `,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.name = 'stars'
    this.points.frustumCulled = false
    this.points.renderOrder = -9
    this.states = Array.from({ length: max }, () => ({
      active: false, entered: false, angle: 0, radius: 0, speed: 0, alpha: 0,
    }))
    // 屏内停放休眠星（避免原点闪烁）
    this.positions.fill(0)
    for (let i = 0; i < max; i += 1) this.positions[i * 3 + 2] = -1
  }

  resize(aspect: number, pixelRatio: number) {
    this.aspect = aspect
    this.pole.set(aspect * 0.55, 0.42)
    this.points.material.uniforms.uPixelRatio.value = pixelRatio
  }

  private inside(x: number, y: number): boolean {
    const margin = 0.05
    return x > -this.aspect - margin && x < this.aspect + margin && y > -1 - margin && y < 1 + margin
  }

  /** 屏幕外但贴近边缘的窄带（保证生成的星很快驶入视野） */
  private nearScreen(x: number, y: number): boolean {
    const margin = 0.7
    return x > -this.aspect - margin && x < this.aspect + margin && y > -1 - margin && y < 1 + margin
  }

  update(delta: number, night: number) {
    this.time += delta
    // 生成率准周期起伏：约 0.06 ~ 0.28 颗/秒，稀疏、时多时少
    const richness = 0.06 + 0.22 * Math.abs(Math.sin(this.time * 0.07) * Math.sin(this.time * 0.031 + 1.7))
    let spawnBudget = richness * delta
    for (let i = 0; i < this.max; i += 1) {
      const star = this.states[i]
      if (star.active) {
        star.angle += star.speed * delta
        const x = this.pole.x + Math.cos(star.angle) * star.radius
        const y = this.pole.y + Math.sin(star.angle) * star.radius
        const inside = this.inside(x, y)
        if (inside) star.entered = true
        else if (star.entered) {
          // 驶入过视野后再次离开屏幕：回收
          star.active = false
          star.entered = false
          this.alphas[i] = 0
          this.positions[i * 3 + 2] = -1
          this.sizes[i] = 0
          continue
        }
        this.positions[i * 3] = x
        this.positions[i * 3 + 1] = y
        this.alphas[i] = star.alpha
      } else if (spawnBudget > 0 && Math.random() < spawnBudget) {
        spawnBudget -= 1
        // 只在屏幕边缘外侧的窄带生成，随轨道缓缓驶入视野
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const radius = 1.2 + Math.random() * 1.6
          const angle = Math.random() * Math.PI * 2
          const x = this.pole.x + Math.cos(angle) * radius
          const y = this.pole.y + Math.sin(angle) * radius
          if (this.inside(x, y) || !this.nearScreen(x, y)) continue
          star.active = true
          star.entered = false
          star.radius = radius
          star.angle = angle
          star.speed = 0.006 + Math.random() * 0.014
          star.alpha = 0.2 + Math.random() * 0.55
          this.positions[i * 3] = x
          this.positions[i * 3 + 1] = y
          this.positions[i * 3 + 2] = 0
          this.alphas[i] = star.alpha
          this.sizes[i] = 18 + Math.random() * 20
          break
        }
      }
    }
    this.points.material.uniforms.uNight.value = night
    const geometry = this.points.geometry
    ;(geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
