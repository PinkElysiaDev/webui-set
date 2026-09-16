import * as THREE from 'three'
import type { ContactAnchor } from './character'
import type { ThemeSnapshot } from './daynight'
import type { WindField } from './windfield'

interface Spark {
  horizontal: number
  vertical: number
  velocity: number
  rise: number
  age: number
  lifetime: number
  size: number
  phase: number
}

export class TouchEffect {
  readonly group = new THREE.Group()
  enabled = true
  private width = 1
  private height = 1
  private seed = 17359
  private emission = 0
  private cursor = 0
  private origin: ContactAnchor | null = null
  private transform = new THREE.Object3D()
  private sparks: Spark[] = Array.from({ length: 64 }, () => ({ horizontal: 0, vertical: 0, velocity: 0, rise: 0, age: -1, lifetime: 2, size: 0, phase: 0 }))
  private alpha = new THREE.InstancedBufferAttribute(new Float32Array(64), 1)
  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private particles: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  constructor() {
    this.group.name = 'hand-flower-sparks'
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uNight;
        uniform float uOpacity;
        void main() {
          vec2 point = (vUv - 0.5) * 2.0;
          float breath = 0.92 + sin(uTime * 1.65) * 0.08;
          float alpha = exp(-dot(point, point) * 12.0) * 0.12 * breath * uOpacity;
          if (alpha < 0.002) discard;
          vec3 tint = mix(vec3(1.0, 0.34, 0.76), vec3(0.66, 0.48, 1.0), uNight);
          gl_FragColor = vec4(tint, alpha);
        }
      `,
    }))
    this.glow.name = 'touch-magic'
    this.glow.renderOrder = 30
    this.glow.frustumCulled = false
    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.setAttribute('aAlpha', this.alpha)
    this.alpha.setUsage(THREE.DynamicDrawUsage)
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: { uNight: { value: 0 } },
      vertexShader: `
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uNight;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec2 point = abs((vUv - 0.5) * 2.0);
          float diamond = 1.0 - smoothstep(0.18, 0.82, point.x + point.y);
          float rays = exp(-point.x * 35.0 - point.y * 3.0) + exp(-point.y * 35.0 - point.x * 3.0);
          float alpha = clamp(diamond + rays * 0.6, 0.0, 1.0) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vec3(1.0, 0.72, 0.9), vec3(0.79, 0.74, 1.0), uNight);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    })
    this.particles = new THREE.InstancedMesh(geometry, material, 64)
    this.particles.name = 'touch-sparks'
    this.particles.renderOrder = 31
    this.particles.frustumCulled = false
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particles.count = 0
    this.group.add(this.glow, this.particles)
    this.group.visible = false
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.clear()
  }

  update(delta: number, time: number, anchor: ContactAnchor | null, wind: WindField, theme: ThemeSnapshot, moving: boolean, lowQuality: boolean) {
    this.origin = anchor
    this.group.visible = Boolean(this.enabled && anchor?.visible)
    if (!this.group.visible || !anchor) { this.clear(); return }
    const scale = THREE.MathUtils.clamp(anchor.scale, 0.55, 1.15)
    const vertical = anchor.vertical - 5 * scale
    this.glow.position.set((anchor.horizontal - this.width / 2) * 2 / this.height, (this.height / 2 - vertical) * 2 / this.height, 0)
    this.glow.scale.setScalar(46 * scale * 2 / this.height)
    this.glow.material.uniforms.uTime.value = moving ? time : 0
    this.glow.material.uniforms.uNight.value = theme.blend
    this.glow.material.uniforms.uOpacity.value = wind.calm
    this.particles.material.uniforms.uNight.value = theme.blend
    if (!moving) { this.clear(); return }
    const capacity = lowQuality ? 6 : this.width < 768 ? 8 : 16
    this.particles.count = capacity
    this.emission += delta * (2 + wind.gust() * 3) * wind.calm
    while (this.emission >= 1) {
      this.emission -= 1
      const spark = this.sparks[this.cursor % capacity]
      this.cursor += 1
      spark.horizontal = anchor.horizontal + (this.random() - 0.5) * 7 * scale
      spark.vertical = vertical - this.random() * 5 * scale
      spark.velocity = -(8 + this.random() * 12) * scale
      spark.rise = (8 + this.random() * 10) * scale
      spark.age = 0
      spark.lifetime = 0.9 + this.random() * 0.6
      spark.size = (2 + this.random() * 3) * scale
      spark.phase = this.random() * Math.PI * 2
    }
    for (let index = 0; index < this.sparks.length; index += 1) {
      const spark = this.sparks[index]
      if (index >= capacity || spark.age < 0 || spark.age > spark.lifetime) {
        spark.age = -1
        this.alpha.setX(index, 0)
        continue
      }
      spark.age += delta
      const sample = wind.sample(spark.horizontal / this.width, 1 - spark.vertical / this.height)
      spark.velocity = THREE.MathUtils.damp(spark.velocity, Math.min(-5 * wind.calm, sample.x * 25 * scale), 2.5, delta)
      spark.horizontal += spark.velocity * delta
      spark.vertical -= (spark.rise + Math.sin(time * 2.1 + spark.phase) * 7 * scale) * delta * wind.calm
      const life = spark.age / spark.lifetime
      const opacity = THREE.MathUtils.smoothstep(life, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(life, 0.48, 1)) * wind.calm
      this.alpha.setX(index, opacity * (0.3 + Math.sin(time * 4 + spark.phase) * 0.08))
      this.transform.position.set((spark.horizontal - this.width / 2) * 2 / this.height, (this.height / 2 - spark.vertical) * 2 / this.height, 0)
      this.transform.rotation.z = spark.phase + spark.age * 0.3
      this.transform.scale.setScalar(spark.size * 2 / this.height)
      this.transform.updateMatrix()
      this.particles.setMatrixAt(index, this.transform.matrix)
    }
    this.alpha.needsUpdate = true
    this.particles.instanceMatrix.needsUpdate = true
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  private clear() {
    this.emission = 0
    this.particles.count = 0
    this.sparks.forEach(spark => { spark.age = -1 })
  }

  snapshot() {
    return {
      visible: this.group.visible, origin: this.origin, capacity: this.particles.count,
      active: this.sparks.filter(spark => spark.age >= 0).map(spark => ({ horizontal: spark.horizontal, vertical: spark.vertical, velocity: spark.velocity })),
    }
  }

  dispose() {
    this.group.removeFromParent()
    this.glow.geometry.dispose()
    this.glow.material.dispose()
    this.particles.geometry.dispose()
    this.particles.material.dispose()
    this.particles.dispose()
    this.group.clear()
  }
}
