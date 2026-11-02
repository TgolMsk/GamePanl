// glTF 2.0 模型统计：纯 Node 读取几何、骨骼、动画、静止包围盒和外部资源。
import { promises as fs } from 'fs'
import { extname, isAbsolute, relative, resolve, sep } from 'path'

export interface GltfAnimationInfo { name: string; seconds: number }
export interface GltfInfo {
  format: 'GLB' | 'glTF'
  /** 三角面数 */
  triangles: number
  /** 顶点数 */
  vertices: number
  /** 骨骼数 */
  bones: number
  animations: GltfAnimationInfo[]
  /** 静止姿势包围盒尺寸 [x, y, z]（米），读不出为 null */
  size: [number, number, number] | null
  /** .gltf 引用的外部相对文件 */
  resources: string[]
  /** asset.generator，没有为 '' */
  generator: string
}

type ObjectData = Record<string, unknown>
type Matrix = number[]
const identity: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function object(value: unknown): ObjectData {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function index(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1
}

function count(value: unknown): number {
  return Math.max(0, index(value))
}

function rounded(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}

function vector(value: unknown, length: number): number[] | null {
  const values = array(value)
  return values.length === length ? values.map(number) : null
}

function relativeUri(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const decoded = decodeURIComponent(value)
    return !decoded || /^[a-z][a-z\d+.-]*:/i.test(decoded) || /^[\\/]/.test(decoded) || isAbsolute(decoded)
      ? null : decoded
  } catch {
    return null
  }
}

/** 列主序矩阵相乘，遵循 glTF 的 T × R × S 顺序 */
function multiply(a: Matrix, b: Matrix): Matrix {
  const result = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k]
    }
  }
  return result.map(number)
}

function localMatrix(node: ObjectData): Matrix {
  const matrix = vector(node.matrix, 16)
  if (matrix) return matrix
  const t = vector(node.translation, 3) ?? [0, 0, 0]
  const s = vector(node.scale, 3) ?? [1, 1, 1]
  const q = vector(node.rotation, 4) ?? [0, 0, 0, 1]
  const length = Math.hypot(...q)
  const [x, y, z, w] = length > 0 ? q.map((v) => v / length) : [0, 0, 0, 1]
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1
  ].map(number)
}

function modelSize(doc: ObjectData, meshes: ObjectData[], accessors: ObjectData[]): GltfInfo['size'] {
  const nodes = array(doc.nodes).map(object)
  const parents = new Map<number, number>()
  nodes.forEach((node, parent) => {
    for (const child of array(node.children)) {
      const i = index(child)
      if (i < nodes.length && i >= 0 && !parents.has(i)) parents.set(i, parent)
    }
  })
  const scenes = array(doc.scenes)
  const selected = scenes[index(doc.scene)] ?? scenes[0]
  const roots = selected === undefined
    ? nodes.map((_, i) => i).filter((i) => !parents.has(i))
    : array(object(selected).nodes).map(index)
  const reachable = new Set<number>()
  const stack = [...roots]
  while (stack.length) {
    const i = stack.pop()!
    if (i < 0 || i >= nodes.length || reachable.has(i)) continue
    reachable.add(i)
    for (const child of array(nodes[i].children)) stack.push(index(child))
  }
  const worlds = new Map<number, Matrix>()
  function world(i: number): Matrix {
    const chain: number[] = []
    const seen = new Set<number>()
    let current: number | undefined = i
    while (current !== undefined && !worlds.has(current) && !seen.has(current)) {
      seen.add(current)
      chain.push(current)
      current = parents.get(current)
    }
    let matrix = current === undefined ? identity : worlds.get(current) ?? identity
    while (chain.length) {
      const child = chain.pop()!
      matrix = multiply(matrix, localMatrix(nodes[child]))
      worlds.set(child, matrix)
    }
    return worlds.get(i) ?? identity
  }
  const lower = [Infinity, Infinity, Infinity]
  const upper = [-Infinity, -Infinity, -Infinity]
  let found = false
  for (const i of reachable) {
    const node = nodes[i]
    const mesh = meshes[index(node.mesh)]
    if (!mesh) continue
    // 蒙皮顶点位于模型空间，网格节点的世界变换不作用于蒙皮网格。
    const matrix = index(node.skin) >= 0 ? identity : world(i)
    for (const primitive of array(mesh.primitives).map(object)) {
      const accessor = accessors[index(object(primitive.attributes).POSITION)]
      if (!accessor) continue
      const min = vector(accessor.min, 3)
      const max = vector(accessor.max, 3)
      if (!min || !max) continue
      for (let corner = 0; corner < 8; corner++) {
        const point = min.map((v, axis) => corner & (1 << axis) ? max[axis] : v)
        for (let axis = 0; axis < 3; axis++) {
          const value = number(matrix[axis] * point[0] + matrix[4 + axis] * point[1]
            + matrix[8 + axis] * point[2] + matrix[12 + axis])
          lower[axis] = Math.min(lower[axis], value)
          upper[axis] = Math.max(upper[axis], value)
        }
      }
      found = true
    }
  }
  return found ? [rounded(upper[0] - lower[0]), rounded(upper[1] - lower[1]), rounded(upper[2] - lower[2])] : null
}

/** 只接受完整的 glTF 2.0 JSON 或 GLB 容器 */
export async function parseGltf(buf: Buffer, opts?: { baseDir?: string }): Promise<GltfInfo> {
  let doc: ObjectData
  let bin: Buffer | undefined
  const format = buf.toString('latin1', 0, 4) === 'glTF' ? 'GLB' : 'glTF'
  try {
    let json: string
    if (format === 'GLB') {
      if (buf.length < 20 || buf.readUInt32LE(4) !== 2 || buf.readUInt32LE(8) !== buf.length) throw new Error()
      let offset = 12
      let chunkIndex = 0
      json = ''
      while (offset < buf.length) {
        if (offset + 8 > buf.length) throw new Error()
        const length = buf.readUInt32LE(offset)
        const type = buf.readUInt32LE(offset + 4)
        offset += 8
        if (length % 4 !== 0 || offset + length > buf.length) throw new Error()
        if (chunkIndex === 0) {
          if (type !== 0x4e4f534a) throw new Error()
          json = buf.toString('utf8', offset, offset + length)
        } else if (type === 0x004e4942) {
          if (chunkIndex !== 1 || bin) throw new Error()
          bin = buf.subarray(offset, offset + length)
        }
        offset += length
        chunkIndex++
      }
    } else json = buf.toString('utf8').replace(/^\uFEFF/, '')
    doc = object(JSON.parse(json))
    const version = object(doc.asset).version
    if (typeof version !== 'string' || !version.startsWith('2.')) throw new Error()
  } catch {
    throw new Error('不是有效的 glTF 2.0 文件')
  }

  const meshes = array(doc.meshes).map(object)
  const accessors = array(doc.accessors).map(object)
  const instances = new Array<number>(meshes.length).fill(0)
  for (const node of array(doc.nodes).map(object)) {
    const i = index(node.mesh)
    if (i >= 0 && i < meshes.length) instances[i]++
  }
  let triangles = 0
  let vertices = 0
  meshes.forEach((mesh, i) => {
    for (const primitive of array(mesh.primitives).map(object)) {
      const position = accessors[index(object(primitive.attributes).POSITION)]
      const vertexCount = count(position?.count)
      const elements = primitive.indices === undefined ? vertexCount : count(accessors[index(primitive.indices)]?.count)
      const mode = primitive.mode === undefined ? 4 : index(primitive.mode)
      const faces = mode === 4 ? elements / 3 : mode === 5 || mode === 6 ? Math.max(0, elements - 2) : 0
      triangles += faces * (instances[i] || 1)
      vertices += vertexCount * (instances[i] || 1)
    }
  })
  const joints = new Set<number>()
  for (const skin of array(doc.skins).map(object)) {
    for (const joint of array(skin.joints)) if (index(joint) >= 0) joints.add(index(joint))
  }
  const buffers = array(doc.buffers).map(object)
  const resources = new Set<string>()
  for (const item of [...buffers, ...array(doc.images).map(object)]) {
    const uri = relativeUri(item.uri)
    if (uri !== null) resources.add(uri)
  }
  const loaded = new Map<number, Promise<Buffer | undefined>>()
  function bufferData(i: number): Promise<Buffer | undefined> {
    const cached = loaded.get(i)
    if (cached) return cached
    const promise = (async (): Promise<Buffer | undefined> => {
      try {
        const buffer = buffers[i]
        if (!buffer) return undefined
        if (buffer.uri === undefined) return i === 0 ? bin : undefined
        if (typeof buffer.uri !== 'string') return undefined
        if (/^data:/i.test(buffer.uri)) {
          const comma = buffer.uri.indexOf(',')
          if (comma < 0) return undefined
          const header = buffer.uri.slice(0, comma)
          const data = buffer.uri.slice(comma + 1)
          // 非 base64 数据按 URI 字节解码，避免把高位字节转成 UTF-8。
          if (/;base64$/i.test(header)) return Buffer.from(decodeURIComponent(data), 'base64')
          const bytes: number[] = []
          for (let p = 0; p < data.length; p++) {
            if (data[p] === '%') {
              if (!/^[\da-f]{2}$/i.test(data.slice(p + 1, p + 3))) return undefined
              bytes.push(parseInt(data.slice(p + 1, p + 3), 16))
              p += 2
            } else bytes.push(data.charCodeAt(p))
          }
          return Buffer.from(bytes)
        }
        const uri = relativeUri(buffer.uri)
        if (!uri || typeof opts?.baseDir !== 'string' || extname(uri).toLowerCase() !== '.bin') return undefined
        const base = resolve(opts.baseDir)
        const file = resolve(base, uri)
        const inside = (root: string, target: string): boolean => {
          const rel = relative(root, target)
          return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
        }
        if (!inside(base, file)) return undefined
        const realBase = await fs.realpath(base)
        const realFile = await fs.realpath(file)
        if (!inside(realBase, realFile)) return undefined
        return await fs.readFile(realFile)
      } catch {
        return undefined
      }
    })()
    loaded.set(i, promise)
    return promise
  }
  async function inputMaximum(value: unknown): Promise<number> {
    const accessor = accessors[index(value)]
    if (!accessor) return 0
    if (array(accessor.max).length) return Math.max(0, number(array(accessor.max)[0]))
    if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR' || accessor.sparse !== undefined) return 0
    const view = object(array(doc.bufferViews)[index(accessor.bufferView)])
    const data = await bufferData(index(view.buffer))
    if (!data) return 0
    const start = count(view.byteOffset) + count(accessor.byteOffset)
    const stride = view.byteStride === undefined ? 4 : index(view.byteStride)
    const length = count(accessor.count)
    const viewEnd = count(view.byteOffset) + count(view.byteLength)
    if (stride < 4 || !length || start + (length - 1) * stride + 4 > Math.min(data.length, viewEnd)) return 0
    let maximum = 0
    for (let i = 0; i < length; i++) maximum = Math.max(maximum, number(data.readFloatLE(start + i * stride)))
    return maximum
  }
  const animations: GltfAnimationInfo[] = []
  for (const [i, value] of array(doc.animations).entries()) {
    const animation = object(value)
    let seconds = 0
    for (const sampler of array(animation.samplers).map(object)) seconds = Math.max(seconds, await inputMaximum(sampler.input))
    animations.push({
      name: typeof animation.name === 'string' && animation.name.trim() ? animation.name : `动作 ${i + 1}`,
      seconds: rounded(seconds)
    })
  }
  return {
    format,
    triangles: number(triangles),
    vertices: number(vertices),
    bones: joints.size,
    animations,
    size: modelSize(doc, meshes, accessors),
    resources: [...resources],
    generator: typeof object(doc.asset).generator === 'string' ? object(doc.asset).generator as string : ''
  }
}
