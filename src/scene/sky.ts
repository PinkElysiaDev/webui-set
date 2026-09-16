import * as THREE from 'three'
import type { ThemeSnapshot } from './daynight'

export class Sky {
  private canopyColor = new THREE.Color()
  private static WHITE = new THREE.Color('white')
  readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uNight: { value: 0 }, uTime: { value: 0 },
      uAspect: { value: 1 },
      uCanopy: { value: new THREE.Color() }, uCanopyStrength: { value: 0 },
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
      uniform vec3 uCanopy;
      uniform float uCanopyStrength;
      float hash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec3 color = mix(uHorizon, uTop, smoothstep(0.28, 1.0, vUv.y));
        // 淡色天幕：主题色柔光自天顶向下罩染（仅日间，uCanopyStrength 夜间归零）
        vec2 canopyDelta = (vUv - vec2(0.5, 1.18)) * vec2(uAspect, 1.0);
        float canopy = exp(-dot(canopyDelta, canopyDelta) * 1.4);
        color = mix(color, uCanopy, canopy * uCanopyStrength);
        // 首版（bbc2fc3）的格点方片星野：160×90 格、0.995 阈值、快闪、
        // 非 HDR 白蓝 mix（不触发 Bloom），上半屏淡入
        vec2 grid = floor(vUv * vec2(160.0, 90.0));
        float star = hash(grid);
        float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + star * 40.0);
        float isStar = step(0.998, star);
        float skyMask = smoothstep(0.35, 0.75, vUv.y);
        vec3 starColor = vec3(0.9, 0.92, 1.0) * twinkle;
        color = mix(color, starColor, isStar * skyMask * uNight * 0.9);
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
    // 天幕色 = 主题玫红向白淡化至约 18% 饱和；夜间强度平滑归零
    this.canopyColor.copy(Sky.WHITE).lerp(theme.colors.primary, 0.18)
    uniforms.uCanopy.value.copy(this.canopyColor)
    uniforms.uCanopyStrength.value = (1 - theme.blend) * 0.85
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
