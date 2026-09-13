import * as THREE from 'three'
import type { WindField } from './windfield'

/**
 * 前景花瓣粒子：挂载在相机空间（z=-18 的屏幕平行层），InstancedMesh
 * 单 draw call。运动 = 风场漂移 + 弱重力 + 相位浮游，出屏回收。
 */
const PETAL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const PETAL_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uNight;
  varying vec2 vUv;
  void main() {
    // 椭圆花瓣形 + 中心到边缘的双色渐变
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p * vec2(1.25, 1.0));
    float alpha = smoothstep(1.0, 0.55, d);
    if (alpha < 0.02) discard;
    float edge = smoothstep(0.0, 1.0, d);
    vec3 color = mix(uColorA, uColorB, edge * 0.7);
    // 夜间整体染蓝压暗
    color = mix(color, color * vec3(0.55, 0.6, 0.9) + vec3(0.02, 0.02, 0.06), uNight);
    gl_FragColor = vec4(color, alpha * 0.9);
  }
`

interface PetalState {
  x: number
  y: number
  rot: number
  rotSpeed: number
  size: number
  phase: number
  depth: number // 0.4 近(大而快) ~ 1.0 远
}

export class PetalLayer {
  readonly mesh: THREE.InstancedMesh
  private states: PetalState[] = []
  private dummy = new THREE.Object3D()
  private time = 0
  private bounds = { halfW: 9, halfH: 5.2 }

  constructor(count: number) {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color('#ffe3ef') },
        uColorB: { value: new THREE.Color('#f472a8') },
        uNight: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, count)
    this.mesh.frustumCulled = false
    for (let i = 0; i < count; i += 1) {
      this.states.push(this.spawn(true))
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }

  setNight(value: number) {
    ;(this.mesh.material as THREE.ShaderMaterial).uniforms.uNight.value = value
  }

  private spawn(anywhere: boolean): PetalState {
    const { halfW, halfH } = this.bounds
    return {
      x: anywhere ? rand(-halfW, halfW) : halfW * rand(1.0, 1.3),
      y: rand(-halfH, halfH * 1.2),
      rot: rand(0, Math.PI * 2),
      rotSpeed: rand(-2.4, 2.4),
      size: rand(0.16, 0.34),
      phase: rand(0, Math.PI * 2),
      depth: rand(0.45, 1.0),
    }
  }

  update(dt: number, wind: WindField, halfW: number, halfH: number) {
    // 相机空间边界（视锥在花瓣层深度的实际尺寸，留 30% 余量回收）
    this.bounds.halfW = halfW * 1.3
    this.bounds.halfH = halfH * 1.3
    this.time += dt
    for (let i = 0; i < this.states.length; i += 1) {
      const p = this.states[i]
      // 相机空间坐标 → uv 采样风场
      const uvX = 0.5 + p.x / (2 * halfW)
      const uvY = 0.5 + p.y / (2 * halfH)
      const w = wind.sample(uvX, uvY)
      const speedScale = (1.35 - p.depth) * 1.6
      p.x += (w.x * speedScale + Math.sin(this.time * 0.8 + p.phase) * 0.06) * dt
      p.y += (w.y * speedScale - 0.12 - Math.cos(this.time * 0.6 + p.phase) * 0.04) * dt
      p.rot += p.rotSpeed * dt * (0.6 + wind.gust())
      // 出屏回收（风向左吹 → 左/下边界回收，右侧重生）
      if (p.x < -this.bounds.halfW || p.y < -this.bounds.halfH) {
        this.states[i] = this.spawn(false)
        continue
      }
      if (p.y > this.bounds.halfH) p.y = this.bounds.halfH
      const d = this.dummy
      d.position.set(p.x, p.y, 0)
      d.rotation.set(0, Math.sin(this.time * 3.1 + p.phase) * 0.35, p.rot)
      const scale = p.size * (1.5 - p.depth)
      d.scale.set(scale, scale * 0.72, 1)
      d.updateMatrix()
      this.mesh.setMatrixAt(i, d.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
