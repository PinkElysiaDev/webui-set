import * as THREE from 'three'

/**
 * 花海背景板：挂在相机前方 z=-40 的全屏面片。
 * shader 职责：cover 铺图、顶部草浪随风摆（uniform 采样风场）、
 * 昼夜乘加调色、夜间星野淡入。
 */
const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BACKDROP_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform float uTime;
  uniform vec2 uWind;      // 风场（屏宽量级）
  uniform vec3 uMul;
  uniform vec3 uAdd;
  uniform float uStars;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // 草浪：图像上沿 0~35% 区域做水平采样偏移（越靠上摆幅越大）
    float band = smoothstep(0.42, 0.0, vUv.y);
    float sway = sin(uTime * 1.6 + vUv.y * 22.0 + vUv.x * 9.0)
               + 0.5 * sin(uTime * 0.7 + vUv.x * 14.0);
    vec2 uv = vUv * uUvScale + uUvOffset;
    uv.x += band * sway * uWind.x * 0.012;

    vec3 color = texture2D(uMap, uv).rgb;

    // 昼夜调色
    color = color * uMul + uAdd;

    // 星野：上半区、按亮度掩码叠加程序化星点
    if (uStars > 0.01) {
      vec2 grid = floor(vUv * vec2(160.0, 90.0));
      float star = hash(grid);
      float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + star * 40.0);
      float isStar = step(0.995, star);
      float skyMask = smoothstep(0.35, 0.75, vUv.y);
      vec3 starColor = vec3(0.9, 0.92, 1.0) * twinkle;
      color = mix(color, starColor, isStar * skyMask * uStars * 0.9);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`

export class Backdrop {
  readonly mesh: THREE.Mesh

  constructor(texture: THREE.Texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: {
        uMap: { value: texture },
        uUvScale: { value: new THREE.Vector2(1, 1) },
        uUvOffset: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(-1, 0) },
        uMul: { value: new THREE.Color(1, 1, 1) },
        uAdd: { value: new THREE.Color(0, 0, 0) },
        uStars: { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
    })
    // 宽高比例由 setAspect 计算 cover
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -10
  }

  /** 视口宽高比变化时重设 cover 铺图与面片尺寸（planeHeight = 覆盖视锥的高度） */
  setAspect(aspect: number, planeHeight: number, imageAspect: number) {
    const material = this.mesh.material as THREE.ShaderMaterial
    // cover：比较视口与图片宽高比
    const scale = new THREE.Vector2(1, 1)
    const offset = new THREE.Vector2(0, 0)
    if (aspect > imageAspect) {
      scale.y = imageAspect / aspect
      offset.y = (1 - scale.y) / 2
    } else {
      scale.x = aspect / imageAspect
      offset.x = (1 - scale.x) / 2
    }
    material.uniforms.uUvScale.value.copy(scale)
    material.uniforms.uUvOffset.value.copy(offset)
    this.mesh.scale.set(planeHeight * aspect, planeHeight, 1)
  }

  update(time: number, windX: number, windY: number, mul: THREE.Color, add: THREE.Color, stars: number) {
    const material = this.mesh.material as THREE.ShaderMaterial
    material.uniforms.uTime.value = time
    material.uniforms.uWind.value.set(windX, windY)
    material.uniforms.uMul.value.copy(mul)
    material.uniforms.uAdd.value.copy(add)
    material.uniforms.uStars.value = stars
  }
}
