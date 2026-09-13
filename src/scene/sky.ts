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
      float hash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec3 color = mix(uHorizon, uTop, smoothstep(0.28, 1.0, vUv.y));
        // 星星为整格方形白色片（格点 hash 阈值取格），夜间在上半屏淡入
        vec2 grid = vUv * vec2(100.0 * uAspect, 100.0);
        float random = hash(floor(grid));
        float star = step(0.993, random);
        float twinkle = 0.78 + 0.22 * sin(uTime * 0.7 + random * 73.0);
        color += vec3(1.5, 1.45, 1.8) * star * twinkle * uNight * smoothstep(0.3, 0.65, vUv.y);
        gl_FragColor = vec4(color, 1.0);
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
