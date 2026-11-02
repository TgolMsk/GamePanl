// 3D 模型查看器与透明 PNG 缩略图渲染，封装 three.js 的加载、动画及资源生命周期。
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  BufferGeometry,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Line,
  LoopRepeat,
  Material,
  Mesh,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Points,
  Scene,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface ModelViewer {
  /** 加载模型并自动对准相机，返回按文件顺序排列的动作名 */
  load(url: string): Promise<string[]>
  /** 循环播放动作；null 停止动画并恢复静止姿势 */
  play(clip: string | null): void
  setPaused(paused: boolean): void
  /** 回到加载后的初始视角 */
  resetView(): void
  dispose(): void
}

// 所有查看器和缩略图共用解码器（three 自带的 Draco 解码文件，由 Vite 打包），单个实例销毁时不终止其他实例的解码任务。
const dracoLoader = new DRACOLoader()

function loadModel(url: string): Promise<GLTF> {
  return new GLTFLoader()
    .setDRACOLoader(dracoLoader)
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(url)
}

function createRenderer(canvas: HTMLCanvasElement, preserveDrawingBuffer = false): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  return renderer
}

function lightScene(scene: Scene, renderer: WebGLRenderer): () => void {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  try {
    const environment = pmrem.fromScene(room)
    scene.environment = environment.texture
    scene.environmentIntensity = 0.8
    const sun = new DirectionalLight(0xffffff, 2.5)
    sun.position.set(3, 5, 4)
    scene.add(sun, new HemisphereLight(0xffffff, 0x8b919b, 1.5))
    return () => {
      scene.environment = null
      environment.dispose()
      pmrem.dispose()
    }
  } catch (error) {
    pmrem.dispose()
    throw error
  } finally {
    room.dispose()
  }
}

/** 去重释放共享几何体、材质、贴图及骨骼纹理，也覆盖未显示的 glTF 场景 */
function disposeObjects(roots: Object3D[]): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<Skeleton>()
  const bitmaps = new Set<ImageBitmap>()
  const collectTexture = (value: unknown): void => {
    if (value instanceof Texture) textures.add(value)
    else if (Array.isArray(value)) value.forEach(collectTexture)
  }
  for (const root of roots) {
    root.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
        geometries.add(object.geometry)
        const list = Array.isArray(object.material) ? object.material : [object.material]
        list.forEach((material) => materials.add(material))
      }
      if (object instanceof SkinnedMesh) skeletons.add(object.skeleton)
    })
  }
  for (const material of materials) {
    Object.values(material).forEach(collectTexture)
    // ShaderMaterial 的自定义贴图可存放在 uniforms 中。
    if ('uniforms' in material && material.uniforms && typeof material.uniforms === 'object') {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform && typeof uniform === 'object' && 'value' in uniform) collectTexture(uniform.value)
      }
    }
  }
  for (const texture of textures) {
    const images: unknown[] = Array.isArray(texture.source.data) ? texture.source.data : [texture.source.data]
    for (const image of images) {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image)
    }
    texture.dispose()
  }
  bitmaps.forEach((bitmap) => bitmap.close())
  skeletons.forEach((skeleton) => skeleton.dispose())
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
}

function modelRoots(model: GLTF): Object3D[] {
  return [...new Set([model.scene, ...model.scenes])]
}

function prepareModel(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof SkinnedMesh) object.frustumCulled = false
  })
  root.updateMatrixWorld(true)
}

function modelBounds(root: Object3D): Box3 {
  const box = new Box3().setFromObject(root, true)
  // 空模型也保持有效的相机和网格尺寸。
  if (box.isEmpty()) box.set(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))
  return box
}

function frameCamera(camera: PerspectiveCamera, box: Box3): number {
  const sphere = box.getBoundingSphere(new Sphere())
  const radius = Math.max(sphere.radius, 0.0001)
  const vertical = camera.fov * Math.PI / 360
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15
  camera.position.copy(sphere.center).addScaledVector(new Vector3(1, 0.65, 1.5).normalize(), distance)
  camera.near = radius / 100
  camera.far = Math.max(radius * 100, distance * 10)
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  return radius
}

function createGrid(box: Box3): GridHelper {
  const extent = box.getSize(new Vector3())
  const size = Math.max(Math.max(extent.x, extent.y, extent.z) * 4, 2)
  const desired = size / 16
  const scale = 10 ** Math.floor(Math.log10(desired))
  const step = [1, 2, 2.5, 5, 10].find((value) => value * scale >= desired)! * scale
  const divisions = Math.ceil(size / step)
  const grid = new GridHelper(divisions * step, divisions, 0xa0a0a0, 0xb8b8b8)
  const center = box.getCenter(new Vector3())
  grid.position.set(center.x, box.min.y, center.z)
  const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
  for (const material of materials) {
    material.transparent = true
    material.opacity = 0.5
    material.depthWrite = false
  }
  return grid
}

export function createModelViewer(canvas: HTMLCanvasElement): ModelViewer {
  const renderer = createRenderer(canvas)
  const scene = new Scene()
  const camera = new PerspectiveCamera(35, 1, 0.01, 100)
  let releaseEnvironment: (() => void) | undefined
  let controls: OrbitControls | undefined
  let observer: ResizeObserver | undefined
  let frame = 0
  let disposed = false
  let generation = 0
  let paused = false
  let model: GLTF | undefined
  let mixer: AnimationMixer | undefined
  let grid: GridHelper | undefined
  let bounds: Box3 | undefined

  const clearModel = (): void => {
    if (model) {
      mixer?.stopAllAction()
      mixer?.uncacheRoot(model.scene)
      scene.remove(model.scene)
      disposeObjects(modelRoots(model))
    }
    if (grid) {
      scene.remove(grid)
      disposeObjects([grid])
    }
    model = undefined
    mixer = undefined
    grid = undefined
    bounds = undefined
    renderer.renderLists.dispose()
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    generation++
    cancelAnimationFrame(frame)
    observer?.disconnect()
    controls?.dispose()
    clearModel()
    releaseEnvironment?.()
    scene.clear()
    renderer.dispose()
  }

  try {
    releaseEnvironment = lightScene(scene, renderer)
    controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.mouseButtons.LEFT = MOUSE.ROTATE
    controls.mouseButtons.MIDDLE = MOUSE.DOLLY
    controls.mouseButtons.RIGHT = MOUSE.PAN
    const resize = (): void => {
      if (disposed) return
      const rect = (canvas.parentElement ?? canvas).getBoundingClientRect()
      const width = Math.max(rect.width, 1)
      const height = Math.max(rect.height, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement ?? canvas)
    resize()
    let previousTime = performance.now()
    const tick = (time: number): void => {
      if (disposed) return
      frame = requestAnimationFrame(tick)
      const dt = Math.min(Math.max((time - previousTime) / 1000, 0), 0.1)
      previousTime = time
      // 隐藏期间仍刷新时间基准，切回页面时不累积动画时间。
      if (document.hidden) return
      mixer?.update(paused ? 0 : dt)
      controls?.update()
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(tick)
  } catch (error) {
    dispose()
    throw error
  }

  const resetView = (): void => {
    if (disposed || !bounds || !controls) return
    // reset 清除阻尼中的旋转和平移，再按当前宽高比重新对准。
    const damping = controls.enableDamping
    controls.enableDamping = false
    controls.reset()
    const radius = frameCamera(camera, bounds)
    controls.target.copy(bounds.getCenter(new Vector3()))
    controls.minDistance = radius * 1.1
    controls.maxDistance = Math.max(radius * 20, camera.position.distanceTo(controls.target) * 3)
    controls.update()
    controls.saveState()
    controls.enableDamping = damping
  }

  return {
    async load(url: string): Promise<string[]> {
      if (disposed) throw new Error('模型查看器已释放')
      const request = ++generation
      clearModel()
      const loaded = await loadModel(url)
      if (disposed || request !== generation) {
        disposeObjects(modelRoots(loaded))
        throw new DOMException('模型加载已被替换或取消', 'AbortError')
      }
      model = loaded
      try {
        prepareModel(loaded.scene)
        scene.add(loaded.scene)
        mixer = new AnimationMixer(loaded.scene)
        bounds = modelBounds(loaded.scene)
        grid = createGrid(bounds)
        scene.add(grid)
        resetView()
        return loaded.animations.map((clip) => clip.name)
      } catch (error) {
        clearModel()
        throw error
      }
    },
    play(name: string | null): void {
      if (disposed || !model || !mixer) return
      mixer.stopAllAction()
      if (name !== null) {
        const clip = model.animations.find((animation) => animation.name === name)
        if (clip) mixer.clipAction(clip).reset().setLoop(LoopRepeat, Infinity).play()
      }
      mixer.update(0)
    },
    setPaused(value: boolean): void {
      if (!disposed) paused = value
    },
    resetView,
    dispose
  }
}

/** 离屏渲染透明 PNG，动作优先取 idle 在 t=0 的姿势 */
export async function renderModelThumbnail(url: string, width = 640, height = 480): Promise<Blob> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError('缩略图尺寸必须是正数')
  }
  const canvas = document.createElement('canvas')
  const renderer = createRenderer(canvas, true)
  const scene = new Scene()
  const camera = new PerspectiveCamera(35, width / height, 0.01, 100)
  let releaseEnvironment: (() => void) | undefined
  let model: GLTF | undefined
  let mixer: AnimationMixer | undefined
  try {
    // 导出的 PNG 使用指定像素尺寸，不随屏幕像素比改变。
    renderer.setPixelRatio(1)
    renderer.setSize(Math.round(width), Math.round(height), false)
    releaseEnvironment = lightScene(scene, renderer)
    model = await loadModel(url)
    prepareModel(model.scene)
    scene.add(model.scene)
    const clip = model.animations.find((animation) => /idle/i.test(animation.name)) ?? model.animations[0]
    if (clip) {
      mixer = new AnimationMixer(model.scene)
      mixer.clipAction(clip).reset().play()
      mixer.update(0)
    }
    model.scene.updateMatrixWorld(true)
    frameCamera(camera, modelBounds(model.scene))
    renderer.render(scene, camera)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('无法生成模型缩略图'))
      }, 'image/png')
    })
  } finally {
    if (model) {
      mixer?.stopAllAction()
      mixer?.uncacheRoot(model.scene)
      disposeObjects(modelRoots(model))
    }
    releaseEnvironment?.()
    scene.clear()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
