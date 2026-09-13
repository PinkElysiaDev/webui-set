import * as THREE from 'three'
import type { WindField } from './windfield'
import type { ThemeSnapshot } from './daynight'

interface PetalState {
  horizontal: number
  vertical: number
  rotation: number
  size: number
  phase: number
  depth: number
}

export class PetalLayer {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private states: PetalState[]
  private transform = new THREE.Object3D()

  constructor(count: number) {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uColor: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform vec3 uEdge;
        void main() {
          vec2 point = (vUv - 0.5) * 2.0;
          float distanceToEdge = length(point * vec2(0.85 + vUv.y * 0.35, 1.0));
          float alpha = 1.0 - smoothstep(0.65, 1.0, distanceToEdge);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(mix(uColor, uEdge, vUv.x * 0.7), alpha * 0.65);
        }
      `,
    })
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count)
    this.mesh.name = 'petals'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.states = Array.from({ length: count }, () => ({
      horizontal: Math.random(), vertical: Math.random(), rotation: Math.random() * Math.PI * 2,
      size: 0.009 + Math.random() * 0.011, phase: Math.random() * Math.PI * 2, depth: 0.4 + Math.random() * 0.6,
    }))
  }

  update(delta: number, time: number, wind: WindField, aspect: number, theme: ThemeSnapshot, lowQuality: boolean) {
    this.mesh.material.uniforms.uColor.value.copy(theme.colors.petal)
    this.mesh.material.uniforms.uEdge.value.copy(theme.colors.petalEdge)
    this.mesh.count = lowQuality ? Math.ceil(this.states.length / 2) : this.states.length
    this.states.forEach((state, index) => {
      const sample = wind.sample(state.horizontal, state.vertical)
      const speed = (1.35 - state.depth) * 0.055
      state.horizontal += sample.x * speed * delta
      state.vertical += (sample.y * speed - 0.012 * wind.calm) * delta
      state.rotation += Math.sin(time * 0.5 + state.phase) * delta * wind.calm
      if (state.horizontal < -0.05 || state.vertical < -0.05) {
        state.horizontal = 1.05
        state.vertical = Math.random()
      }
      if (state.horizontal > 1.1) state.horizontal = -0.04
      if (state.vertical > 1.05) state.vertical = -0.04
      const size = state.size * (1.5 - state.depth)
      this.transform.position.set((state.horizontal - 0.5) * aspect * 2, (state.vertical - 0.5) * 2, 0)
      this.transform.rotation.set(0, Math.sin(time + state.phase) * 0.5, state.rotation)
      this.transform.scale.set(size, size * 0.62, 1)
      this.transform.updateMatrix()
      this.mesh.setMatrixAt(index, this.transform.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
