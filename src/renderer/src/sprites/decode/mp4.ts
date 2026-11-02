export interface Mp4Sample {
  /** 在文件里的字节偏移 */
  offset: number
  size: number
  /** 解码时间（媒体时间单位） */
  dts: number
  /** 显示时间 = dts + ctts 偏移（媒体时间单位） */
  cts: number
  duration: number
  keyframe: boolean
}

export type Mp4Matrix = 'bt709' | 'bt601' | 'bt2020' | null

export interface Mp4VideoTrack {
  /** WebCodecs 编码字符串，如 avc1.64002a、hvc1.1.6.L120.90 */
  codec: string
  /** 样本描述里的宽高 */
  width: number
  height: number
  /** avcC / hvcC 的内容，不含 box 头 */
  description: Uint8Array
  timescale: number
  /** 媒体时长（timescale 单位） */
  duration: number
  /** 固定间隔用 timescale / delta，否则用样本数 / 秒数 */
  fps: number
  /** 按解码顺序 */
  samples: Mp4Sample[]
  /** 优先使用 colr，没有时尝试 H.264 SPS 的 VUI */
  color: { matrix: Mp4Matrix; fullRange: boolean | null }
}

interface Box {
  type: string
  start: number
  end: number
  children: Box[]
}

type Color = Mp4VideoTrack['color']

function invalid(message: string): never {
  throw new Error(`MP4 / MOV 数据损坏：${message}`)
}

function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) invalid('数值超出安全整数范围')
  return value
}

/** 所有读取都限制在当前 box 内，避免残缺字段越过边界。 */
class Reader {
  private view: DataView

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  check(offset: number, length: number, end = this.bytes.length): void {
    if (offset < 0 || length < 0 || offset > end - length || end > this.bytes.length) {
      invalid('字段或样本超出文件边界')
    }
  }

  u8(offset: number, end: number): number {
    this.check(offset, 1, end)
    return this.view.getUint8(offset)
  }

  u16(offset: number, end: number): number {
    this.check(offset, 2, end)
    return this.view.getUint16(offset)
  }

  u32(offset: number, end: number): number {
    this.check(offset, 4, end)
    return this.view.getUint32(offset)
  }

  i32(offset: number, end: number): number {
    this.check(offset, 4, end)
    return this.view.getInt32(offset)
  }

  u64(offset: number, end: number): number {
    return safeInteger(this.u32(offset, end) * 0x100000000 + this.u32(offset + 4, end))
  }

  text(offset: number, end: number): string {
    this.check(offset, 4, end)
    return String.fromCharCode(...this.bytes.subarray(offset, offset + 4))
  }

  boxes(start: number, end: number, depth = 0): Box[] {
    if (depth > 32) invalid('容器嵌套过深')
    const result: Box[] = []
    while (start < end) {
      this.check(start, 8, end)
      let size = this.u32(start, end)
      const type = this.text(start + 4, end)
      let header = 8
      if (size === 1) {
        size = this.u64(start + 8, end)
        header = 16
      } else if (size === 0) {
        size = end - start
      }
      if (size < header || size > end - start) invalid(`无效的 ${type} box 长度`)
      const box: Box = { type, start: start + header, end: start + size, children: [] }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf'].includes(type)) {
        box.children = this.boxes(box.start, box.end, depth + 1)
      }
      result.push(box)
      start += size
    }
    return result
  }
}

function required(boxes: Box[], type: string): Box {
  const box = boxes.find((item) => item.type === type)
  if (!box) invalid(`缺少 ${type} box`)
  return box
}

function version(reader: Reader, box: Box, allowed: number[]): number {
  reader.check(box.start, 4, box.end)
  const value = reader.u8(box.start, box.end)
  if (!allowed.includes(value)) invalid(`不支持的 ${box.type} 版本：${value}`)
  return value
}

function entryCount(reader: Reader, box: Box, stride: number): number {
  const count = reader.u32(box.start + 4, box.end)
  reader.check(box.start + 8, count * stride, box.end)
  return count
}

function matrixName(code: number): Mp4Matrix {
  if (code === 1) return 'bt709'
  if (code === 5 || code === 6) return 'bt601'
  if (code === 9 || code === 10) return 'bt2020'
  return null
}

function readColr(reader: Reader, boxes: Box[]): Color | null {
  // nclx 优先于旧 QuickTime 的 nclc；其他颜色描述类型不作为 VUI 的替代品。
  for (const type of ['nclx', 'nclc']) {
    for (const box of boxes) {
      if (box.type !== 'colr' || reader.text(box.start, box.end) !== type) continue
      reader.check(box.start, type === 'nclx' ? 11 : 10, box.end)
      return {
        matrix: matrixName(reader.u16(box.start + 8, box.end)),
        fullRange: type === 'nclx' ? (reader.u8(box.start + 10, box.end) & 0x80) !== 0 : null
      }
    }
  }
  return null
}

class BitReader {
  private position = 0

  constructor(private bytes: Uint8Array) {}

  bits(count: number): number {
    if (count < 0 || this.position + count > this.bytes.length * 8) invalid('SPS 位流截断')
    let value = 0
    for (let i = 0; i < count; i++) {
      value = value * 2 + ((this.bytes[this.position >>> 3] >>> (7 - (this.position & 7))) & 1)
      this.position++
    }
    return value
  }

  ue(): number {
    let zeros = 0
    while (this.bits(1) === 0) {
      if (++zeros > 31) invalid('SPS 指数哥伦布码过长')
    }
    return 2 ** zeros - 1 + this.bits(zeros)
  }

  se(): number {
    const value = this.ue()
    return value % 2 === 0 ? -value / 2 : (value + 1) / 2
  }
}

function skipScalingList(bits: BitReader, count: number): void {
  let lastScale = 8
  let nextScale = 8
  for (let i = 0; i < count; i++) {
    if (nextScale !== 0) nextScale = ((lastScale + bits.se()) % 256 + 256) % 256
    if (nextScale !== 0) lastScale = nextScale
  }
}

/** VUI 只是可选提示；损坏或缺失的 SPS 不妨碍样本解封装。 */
function readAvcColor(description: Uint8Array): Color | null {
  try {
    const reader = new Reader(description)
    if ((reader.u8(5, description.length) & 31) === 0) return null
    const length = reader.u16(6, description.length)
    reader.check(8, length)
    if (length < 2 || (description[8] & 31) !== 7) return null
    const rbsp = new Uint8Array(length - 1)
    let count = 0
    let zeros = 0
    for (let i = 9; i < 8 + length; i++) {
      const value = description[i]
      if (zeros >= 2 && value === 3) {
        zeros = 0
        continue
      }
      rbsp[count++] = value
      zeros = value === 0 ? zeros + 1 : 0
    }
    const bits = new BitReader(rbsp.subarray(0, count))
    const profile = bits.bits(8)
    bits.bits(8) // constraint 标志及保留位
    bits.bits(8) // level_idc
    bits.ue() // seq_parameter_set_id
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      const chroma = bits.ue()
      if (chroma > 3) return null
      if (chroma === 3) bits.bits(1)
      bits.ue() // bit_depth_luma_minus8
      bits.ue() // bit_depth_chroma_minus8
      bits.bits(1) // qpprime_y_zero_transform_bypass_flag
      if (bits.bits(1)) {
        for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
          if (bits.bits(1)) skipScalingList(bits, i < 6 ? 16 : 64)
        }
      }
    }
    bits.ue() // log2_max_frame_num_minus4
    const orderType = bits.ue()
    if (orderType === 0) {
      bits.ue() // log2_max_pic_order_cnt_lsb_minus4
    } else if (orderType === 1) {
      bits.bits(1)
      bits.se()
      bits.se()
      const refs = bits.ue()
      if (refs > 255) return null
      for (let i = 0; i < refs; i++) bits.se()
    } else if (orderType !== 2) {
      return null
    }
    bits.ue() // max_num_ref_frames
    bits.bits(1) // gaps_in_frame_num_value_allowed_flag
    bits.ue() // pic_width_in_mbs_minus1
    bits.ue() // pic_height_in_map_units_minus1
    if (!bits.bits(1)) bits.bits(1) // mb_adaptive_frame_field_flag
    bits.bits(1) // direct_8x8_inference_flag
    if (bits.bits(1)) {
      for (let i = 0; i < 4; i++) bits.ue()
    }
    if (!bits.bits(1)) return null // vui_parameters_present_flag
    if (bits.bits(1) && bits.bits(8) === 255) {
      bits.bits(16)
      bits.bits(16)
    }
    if (bits.bits(1)) bits.bits(1) // overscan_appropriate_flag
    if (!bits.bits(1)) return { matrix: null, fullRange: null }
    bits.bits(3) // video_format
    const fullRange = bits.bits(1) !== 0
    let matrix: Mp4Matrix = null
    if (bits.bits(1)) {
      bits.bits(8) // colour_primaries
      bits.bits(8) // transfer_characteristics
      matrix = matrixName(bits.bits(8))
    }
    return { matrix, fullRange }
  } catch {
    return null
  }
}

function codecString(type: string, description: Uint8Array): string {
  const reader = new Reader(description)
  const end = description.length
  if (reader.u8(0, end) !== 1) invalid('无效的解码器配置版本')
  if (type === 'avc1' || type === 'avc3') {
    reader.check(0, 7)
    return `${type}.${[description[1], description[2], description[3]]
      .map((value) => value.toString(16).padStart(2, '0')).join('')}`
  }
  reader.check(0, 23)
  const profile = description[1]
  let compatibility = reader.u32(2, end)
  let reversed = 0
  for (let i = 0; i < 32; i++) {
    reversed = reversed * 2 + (compatibility & 1)
    compatibility >>>= 1
  }
  const space = ['', 'A', 'B', 'C'][profile >>> 6]
  const tier = profile & 0x20 ? 'H' : 'L'
  let codec = `${type}.${space}${profile & 31}.${reversed.toString(16).toUpperCase()}.${tier}${description[12]}`
  let last = 11
  while (last >= 6 && description[last] === 0) last--
  for (let i = 6; i <= last; i++) codec += `.${description[i].toString(16).padStart(2, '0').toUpperCase()}`
  return codec
}

function readDescription(reader: Reader, stsd: Box): Pick<Mp4VideoTrack, 'codec' | 'width' | 'height' | 'description' | 'color'> {
  version(reader, stsd, [0])
  const count = reader.u32(stsd.start + 4, stsd.end)
  const entries = reader.boxes(stsd.start + 8, stsd.end)
  if (count === 0 || entries.length !== count) invalid('样本描述表为空或数量不一致')
  const entry = entries[0]
  const avc = entry.type === 'avc1' || entry.type === 'avc3'
  if (!avc && entry.type !== 'hvc1' && entry.type !== 'hev1') {
    throw new Error(`不支持的视频编码：${entry.type}，请导出为 H.264 或 HEVC`)
  }
  reader.check(entry.start, 78, entry.end)
  const width = reader.u16(entry.start + 24, entry.end)
  const height = reader.u16(entry.start + 26, entry.end)
  const children = reader.boxes(entry.start + 78, entry.end)
  const config = required(children, avc ? 'avcC' : 'hvcC')
  const description = reader.bytes.subarray(config.start, config.end)
  return {
    codec: codecString(entry.type, description),
    width,
    height,
    description,
    color: readColr(reader, children) ?? (avc ? readAvcColor(description) : null) ?? { matrix: null, fullRange: null }
  }
}

function sampleCount(reader: Reader, box: Box): number {
  version(reader, box, [0])
  return reader.u32(box.start + 8, box.end)
}

function readSizes(reader: Reader, box: Box, count: number): number[] {
  const start = box.start + 12
  let fieldSize = 32
  let fixedSize = 0
  if (box.type === 'stsz') {
    fixedSize = reader.u32(box.start + 4, box.end)
  } else {
    fieldSize = reader.u8(box.start + 7, box.end)
    if (![4, 8, 16].includes(fieldSize)) invalid('stz2 字段宽度必须为 4、8 或 16')
  }
  if (!fixedSize) reader.check(start, Math.ceil(count * fieldSize / 8), box.end)
  // 每个有效视频样本至少需要一个字节，拒绝伪造的超大样本计数。
  if (count > reader.bytes.length) invalid('样本数超过文件可容纳范围')
  const sizes: number[] = []
  for (let i = 0; i < count; i++) {
    let size = fixedSize
    if (!size) {
      if (fieldSize === 4) size = (reader.u8(start + (i >>> 1), box.end) >>> (i % 2 === 0 ? 4 : 0)) & 15
      else if (fieldSize === 8) size = reader.u8(start + i, box.end)
      else if (fieldSize === 16) size = reader.u16(start + i * 2, box.end)
      else size = reader.u32(start + i * 4, box.end)
    }
    sizes.push(size)
  }
  return sizes
}

function readSamples(reader: Reader, stbl: Box, sizes: number[]): { samples: Mp4Sample[]; total: number; delta: number | null } {
  const stsc = required(stbl.children, 'stsc')
  const offsets = stbl.children.find((box) => box.type === 'stco' || box.type === 'co64')
  if (!offsets) invalid('缺少 stco / co64 box')
  version(reader, offsets, [0])
  version(reader, stsc, [0])
  const stride = offsets.type === 'co64' ? 8 : 4
  const chunks = entryCount(reader, offsets, stride)
  const runs = entryCount(reader, stsc, 12)
  if (sizes.length > 0 && (runs === 0 || chunks === 0)) invalid('样本缺少块映射')
  let previous = 0
  for (let i = 0; i < runs; i++) {
    const start = stsc.start + 8 + i * 12
    const first = reader.u32(start, stsc.end)
    if (first <= previous || first > chunks || (i === 0 && first !== 1)) invalid('stsc 块序号无效')
    if (reader.u32(start + 4, stsc.end) === 0) invalid('stsc 每块样本数为零')
    if (reader.u32(start + 8, stsc.end) !== 1) {
      throw new Error('不支持切换视频样本描述，请导出为单一 H.264 或 HEVC 编码')
    }
    previous = first
  }
  const samples: Mp4Sample[] = []
  let run = 0
  for (let chunk = 1; chunk <= chunks; chunk++) {
    if (runs === 0) invalid('块偏移缺少 stsc 映射')
    if (run + 1 < runs && chunk === reader.u32(stsc.start + 8 + (run + 1) * 12, stsc.end)) run++
    const perChunk = reader.u32(stsc.start + 12 + run * 12, stsc.end)
    if (perChunk > sizes.length - samples.length) invalid('块内样本数超过 stsz / stz2')
    const position = offsets.start + 8 + (chunk - 1) * stride
    let offset = stride === 8 ? reader.u64(position, offsets.end) : reader.u32(position, offsets.end)
    for (let i = 0; i < perChunk; i++) {
      const size = sizes[samples.length]
      reader.check(offset, size)
      samples.push({ offset, size, dts: 0, cts: 0, duration: 0, keyframe: true })
      offset += size
    }
  }
  if (samples.length !== sizes.length) invalid('块映射与样本数不一致')

  const stts = required(stbl.children, 'stts')
  version(reader, stts, [0])
  const timingRuns = entryCount(reader, stts, 8)
  let index = 0
  let total = 0
  let delta: number | null = null
  let variable = false
  for (let i = 0; i < timingRuns; i++) {
    const start = stts.start + 8 + i * 8
    const count = reader.u32(start, stts.end)
    const duration = reader.u32(start + 4, stts.end)
    if (count > samples.length - index) invalid('stts 样本数超过大小表')
    if (!count) continue
    if (delta === null) delta = duration
    else if (delta !== duration) variable = true
    for (let j = 0; j < count; j++) {
      const sample = samples[index++]
      sample.dts = total
      sample.cts = total
      sample.duration = duration
      total = safeInteger(total + duration)
    }
  }
  if (index !== samples.length) invalid('stts 与样本数不一致')

  const ctts = stbl.children.find((box) => box.type === 'ctts')
  if (ctts) {
    const signed = version(reader, ctts, [0, 1]) === 1
    const count = entryCount(reader, ctts, 8)
    index = 0
    for (let i = 0; i < count; i++) {
      const start = ctts.start + 8 + i * 8
      const repeat = reader.u32(start, ctts.end)
      const offset = signed ? reader.i32(start + 4, ctts.end) : reader.u32(start + 4, ctts.end)
      if (repeat > samples.length - index) invalid('ctts 样本数超过大小表')
      for (let j = 0; j < repeat; j++) {
        const sample = samples[index++]
        sample.cts = safeInteger(sample.dts + offset)
      }
    }
    if (index !== samples.length) invalid('ctts 与样本数不一致')
  }

  const stss = stbl.children.find((box) => box.type === 'stss')
  if (stss) {
    version(reader, stss, [0])
    const count = entryCount(reader, stss, 4)
    for (const sample of samples) sample.keyframe = false
    previous = 0
    for (let i = 0; i < count; i++) {
      const sample = reader.u32(stss.start + 8 + i * 4, stss.end)
      if (sample <= previous || sample > samples.length) invalid('stss 关键帧序号无效')
      samples[sample - 1].keyframe = true
      previous = sample
    }
  }
  return { samples, total, delta: variable ? null : delta }
}

/** 解析第一条视频轨；时间保持媒体时间单位，不应用 edts 的影片时间轴编辑。 */
export function parseMp4(buf: Uint8Array): Mp4VideoTrack {
  if (buf.length < 8) throw new Error('不是 MP4 / MOV 文件')
  const reader = new Reader(buf)
  const boxes = reader.boxes(0, buf.length)
  const moov = boxes.find((box) => box.type === 'moov')
  const fragmented = boxes.some((box) => box.type === 'moof')
  if (!moov) {
    if (fragmented) throw new Error('不支持分段 MP4（fragmented）')
    throw new Error('不是 MP4 / MOV 文件')
  }
  for (const trak of moov.children) {
    if (trak.type !== 'trak') continue
    const mdia = trak.children.find((box) => box.type === 'mdia')
    if (!mdia) continue
    const hdlr = mdia.children.find((box) => box.type === 'hdlr')
    if (!hdlr || reader.text(hdlr.start + 8, hdlr.end) !== 'vide') continue
    const minf = mdia.children.find((box) => box.type === 'minf')
    const stbl = minf?.children.find((box) => box.type === 'stbl')
    const sizeBox = stbl?.children.find((box) => box.type === 'stsz' || box.type === 'stz2')
    if (fragmented && (!sizeBox || sampleCount(reader, sizeBox) === 0)) {
      throw new Error('不支持分段 MP4（fragmented）')
    }
    if (!stbl) invalid('缺少视频样本表 stbl')
    if (!sizeBox) invalid('缺少 stsz / stz2 box')
    const mdhd = required(mdia.children, 'mdhd')
    const mdhdVersion = version(reader, mdhd, [0, 1])
    reader.check(mdhd.start, mdhdVersion === 1 ? 36 : 24, mdhd.end)
    const timescale = reader.u32(mdhd.start + (mdhdVersion === 1 ? 20 : 12), mdhd.end)
    if (!timescale) invalid('媒体时间单位为零')
    const duration = mdhdVersion === 1
      ? reader.u64(mdhd.start + 24, mdhd.end)
      : reader.u32(mdhd.start + 16, mdhd.end)
    const description = readDescription(reader, required(stbl.children, 'stsd'))
    const sizes = readSizes(reader, sizeBox, sampleCount(reader, sizeBox))
    const { samples, total, delta } = readSamples(reader, stbl, sizes)
    const fps = delta !== null && delta > 0 ? timescale / delta : total > 0 ? samples.length * timescale / total : 0
    return { ...description, timescale, duration, fps, samples }
  }
  if (fragmented) throw new Error('不支持分段 MP4（fragmented）')
  throw new Error('没有视频轨')
}
