// three 附带的 ammo.wasm.js 无类型定义
declare module 'three/examples/jsm/libs/ammo.wasm.js' {
  interface AmmoModuleOptions {
    locateFile?: (path: string) => string
  }
  const AmmoFactory: (options?: AmmoModuleOptions) => Promise<unknown>
  export default AmmoFactory
}
declare module 'three/examples/jsm/libs/ammo.wasm.wasm?url' {
  const url: string
  export default url
}
