import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMp4, type Mp4VideoTrack } from '../../src/renderer/src/sprites/decode/mp4'

const sourcePath = '/Users/ws/Downloads/wan3_run_swordsman.mp4'

function run(program: string, args: string[]): string {
  return execFileSync(program, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024
  })
}

function checkPackets(path: string, track: Mp4VideoTrack): number[] {
  const csv = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=pts,flags,size,pos', '-of', 'csv', path
  ])
  // ffprobe 按字段定义顺序输出 pts、size、pos、flags，而不是命令中的顺序。
  const packets = csv.trim().split(/\r?\n/).filter((line) => line.startsWith('packet,')).map((line) => {
    const [, pts, size, pos, flags] = line.split(',')
    assert.ok(Number.isFinite(Number(pts)), `无法解析包的 pts：${line}`)
    assert.ok(Number.isFinite(Number(size)), `无法解析包的 size：${line}`)
    assert.ok(Number.isFinite(Number(pos)), `无法解析包的 pos：${line}`)
    return { pts: Number(pts), size: Number(size), pos: Number(pos), keyframe: flags.includes('K') }
  })
  assert.equal(track.samples.length, packets.length, '样本数应与 ffprobe 一致')
  const byPosition = new Map(packets.map((packet) => [packet.pos, packet]))
  assert.equal(byPosition.size, packets.length, '每个包的位置应唯一')
  let nextDts = 0
  track.samples.forEach((sample, index) => {
    const packet = byPosition.get(sample.offset)
    assert.ok(packet, `样本 ${index} 的 offset=${sample.offset} 未匹配到包`)
    assert.equal(sample.offset, packets[index].pos, `样本 ${index} 的解码顺序不符`)
    assert.equal(sample.size, packet.size, `样本 ${index} 的 size 不符`)
    assert.equal(sample.keyframe, packet.keyframe, `样本 ${index} 的关键帧标记不符`)
    // ffprobe 会应用 edts；消除整轨时间平移后比较显示时间和重排序。
    assert.equal(sample.cts - track.samples[0].cts, packet.pts - packets[0].pts, `样本 ${index} 的 cts 不符`)
    assert.equal(sample.dts, nextDts, `样本 ${index} 的 dts 不连续`)
    assert.ok(sample.duration > 0, `样本 ${index} 的 duration 应为正数`)
    nextDts += sample.duration
  })
  const expected = packets.flatMap((packet, index) => packet.keyframe ? [index] : [])
  const actual = track.samples.flatMap((sample, index) => sample.keyframe ? [index] : [])
  assert.deepEqual(actual, expected, '从 0 开始的关键帧帧号应与 ffprobe 一致')
  return actual
}

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value)
  return bytes
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value >>> 0)
  return bytes
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(value))
  return bytes
}

function box(type: string, payload = Buffer.alloc(0), mode: 'normal' | 'large' | 'rest' = 'normal'): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  if (mode === 'large') return Buffer.concat([u32(1), typeBytes, u64(payload.length + 16), payload])
  return Buffer.concat([u32(mode === 'rest' ? 0 : payload.length + 8), typeBytes, payload])
}

function fullBox(type: string, payload: Buffer, version = 0): Buffer {
  return box(type, Buffer.concat([Buffer.from([version, 0, 0, 0]), payload]))
}

function table(type: string, rows: number[][], version = 0): Buffer {
  return fullBox(type, Buffer.concat([u32(rows.length), ...rows.flatMap((row) => row.map(u32))]), version)
}

interface FixtureOptions {
  description: Uint8Array
  sampleType?: string
  sizeMode?: 4 | 8 | 16 | 'variable' | 'fixed'
  unsignedCtts?: boolean
  emptyStss?: boolean
  colr?: { type: 'nclx' | 'nclc'; matrix: number; fullRange: boolean }
}

function fixture(options: FixtureOptions): Buffer {
  const { description, sampleType = 'avc1', sizeMode = 'variable', unsignedCtts = false, colr } = options
  const sizes = sizeMode === 'fixed' ? [5, 5, 5] : [3, 5, 7]
  let sizeBox: Buffer
  if (typeof sizeMode === 'number') {
    const packed = sizeMode === 4
      ? Buffer.from([0x35, 0x70])
      : sizeMode === 8 ? Buffer.from(sizes) : Buffer.concat(sizes.map(u16))
    sizeBox = fullBox('stz2', Buffer.concat([Buffer.from([0, 0, 0, sizeMode]), u32(3), packed]))
  } else {
    sizeBox = fullBox('stsz', Buffer.concat([
      u32(sizeMode === 'fixed' ? 5 : 0), u32(3),
      ...(sizeMode === 'fixed' ? [] : sizes.map(u32))
    ]))
  }
  const entryHeader = Buffer.alloc(78)
  entryHeader.writeUInt16BE(1, 6)
  entryHeader.writeUInt16BE(64, 24)
  entryHeader.writeUInt16BE(48, 26)
  entryHeader.writeUInt16BE(1, 40)
  entryHeader.writeUInt16BE(24, 74)
  entryHeader.writeInt16BE(-1, 76)
  const colrBox = colr ? box('colr', Buffer.concat([
    Buffer.from(colr.type, 'ascii'), u16(2), u16(2), u16(colr.matrix),
    ...(colr.type === 'nclx' ? [Buffer.from([colr.fullRange ? 0x80 : 0])] : [])
  ])) : Buffer.alloc(0)
  const sampleEntry = box(sampleType, Buffer.concat([
    entryHeader, box(sampleType === 'hvc1' || sampleType === 'hev1' ? 'hvcC' : 'avcC', Buffer.from(description)), colrBox
  ]))
  const stbl = box('stbl', Buffer.concat([
    fullBox('stsd', Buffer.concat([u32(1), sampleEntry])),
    table('stts', [[2, 100], [1, 200]]),
    table('ctts', unsignedCtts ? [[2, 20], [1, 10]] : [[1, -20], [2, 10]], unsignedCtts ? 0 : 1),
    table('stsc', [[1, 2, 1], [2, 1, 1]]), sizeBox,
    ...(options.emptyStss ? [table('stss', [])] : []),
    fullBox('co64', Buffer.concat([u32(2), u64(40), u64(60)]))
  ]), 'rest')
  const mdhd = fullBox('mdhd', Buffer.concat([
    u64(0), u64(0), u32(1000), u64(400), u16(0), u16(0)
  ]), 1)
  const hdlr = fullBox('hdlr', Buffer.concat([u32(0), Buffer.from('vide'), Buffer.alloc(13)]))
  const mdia = box('mdia', Buffer.concat([
    mdhd, hdlr, box('minf', Buffer.concat([box('dinf'), stbl]))
  ]))
  const moov = box('moov', Buffer.concat([
    box('meta', Buffer.from('这些内容不是子 box，必须跳过')),
    box('trak', Buffer.concat([box('edts'), mdia]))
  ]), 'large')
  return Buffer.concat([
    box('ftyp', Buffer.concat([Buffer.from('isom'), u32(0), Buffer.from('isommp42')])),
    box('mdat', Buffer.alloc(128), 'large'), moov
  ])
}

function withoutColr(bytes: Uint8Array): Uint8Array {
  const copy = Buffer.from(bytes)
  let replaced = 0
  const visit = (start: number, end: number): void => {
    for (let pos = start; pos < end;) {
      const rawSize = copy.readUInt32BE(pos)
      const type = copy.toString('ascii', pos + 4, pos + 8)
      const header = rawSize === 1 ? 16 : 8
      const size = rawSize === 0 ? end - pos : rawSize === 1 ? Number(copy.readBigUInt64BE(pos + 8)) : rawSize
      assert.ok(size >= header && pos + size <= end, '测试夹具的 box 尺寸不合法')
      const body = pos + header
      if (type === 'colr') {
        copy.write('free', pos + 4, 'ascii')
        replaced += 1
      } else if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        visit(body, pos + size)
      } else if (type === 'stsd') {
        visit(body + 8, pos + size)
      } else if (['avc1', 'avc3', 'hvc1', 'hev1'].includes(type)) {
        visit(body + 78, pos + size)
      }
      pos += size
    }
  }
  visit(0, copy.length)
  assert.ok(replaced > 0, '生成的视频必须包含 colr 才能验证 SPS 回退')
  return copy
}

function complexSpsDescription(): Buffer {
  const bits: number[] = []
  const write = (value: number, length: number): void => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1)
  }
  const ue = (value: number): void => {
    const length = Math.floor(Math.log2(value + 1))
    write(0, length)
    write(value + 1, length + 1)
  }
  const se = (value: number): void => ue(value <= 0 ? -2 * value : 2 * value - 1)
  write(244, 8)
  write(0, 8)
  write(40, 8)
  ue(0)
  ue(3)
  write(1, 1)
  ue(2)
  ue(2)
  write(0, 1)
  write(1, 1)
  // chroma_format_idc=3 有 12 个列表；默认列表只读第一个 -8，不能继续消耗位。
  for (let index = 0; index < 12; index += 1) {
    const present = [0, 1, 6, 11].includes(index)
    write(present ? 1 : 0, 1)
    if (!present) continue
    if (index === 0 || index === 11) se(-8)
    else for (let entry = 0; entry < (index < 6 ? 16 : 64); entry += 1) se(0)
  }
  ue(0)
  ue(1)
  write(0, 1)
  se(-1)
  se(1)
  ue(2)
  se(-2)
  se(3)
  ue(2)
  write(0, 1)
  ue(3)
  ue(1)
  write(0, 1)
  write(1, 1)
  write(1, 1)
  write(1, 1)
  for (const crop of [1, 2, 3, 4]) ue(crop)
  write(1, 1)
  write(1, 1)
  write(255, 8)
  write(4, 16)
  write(3, 16)
  write(1, 1)
  write(0, 1)
  write(1, 1)
  write(5, 3)
  write(1, 1)
  write(1, 1)
  write(9, 8)
  write(16, 8)
  write(9, 8)
  write(0, 6)
  write(1, 1)
  while (bits.length % 8 !== 0) bits.push(0)
  const nal = [0x67]
  let zeros = 0
  for (let pos = 0; pos < bits.length; pos += 8) {
    let value = 0
    for (let index = 0; index < 8; index += 1) value = (value << 1) | bits[pos + index]
    if (zeros >= 2 && value <= 3) {
      nal.push(3)
      zeros = 0
    }
    nal.push(value)
    zeros = value === 0 ? zeros + 1 : 0
  }
  return Buffer.concat([Buffer.from([1, 244, 0, 40, 0xff, 0xe1]), u16(nal.length), Buffer.from(nal), Buffer.from([0])])
}

function checkSynthetic(description: Uint8Array): void {
  const avcSuffix = Array.from(description.subarray(1, 4), (value) => value.toString(16).padStart(2, '0')).join('')
  for (const sizeMode of [4, 8, 16, 'variable', 'fixed'] as const) {
    const track = parseMp4(fixture({ description, sizeMode }))
    const sizes = sizeMode === 'fixed' ? [5, 5, 5] : [3, 5, 7]
    assert.equal(track.codec, `avc1.${avcSuffix}`)
    assert.equal(track.width, 64)
    assert.equal(track.height, 48)
    assert.equal(track.timescale, 1000)
    assert.equal(track.duration, 400)
    assert.equal(track.fps, 7.5)
    assert.deepEqual(track.samples, [
      { offset: 40, size: sizes[0], dts: 0, cts: -20, duration: 100, keyframe: true },
      { offset: 40 + sizes[0], size: sizes[1], dts: 100, cts: 110, duration: 100, keyframe: true },
      { offset: 60, size: sizes[2], dts: 200, cts: 210, duration: 200, keyframe: true }
    ])
  }
  const avc3 = parseMp4(fixture({ description, sampleType: 'avc3', unsignedCtts: true }))
  assert.equal(avc3.codec, `avc3.${avcSuffix}`)
  assert.deepEqual(avc3.samples.map((sample) => sample.cts), [20, 120, 210])
  assert.ok(parseMp4(fixture({ description, emptyStss: true })).samples.every((sample) => !sample.keyframe))
  const framed = Buffer.concat([Buffer.alloc(13, 0xaa), fixture({ description }), Buffer.alloc(7, 0xbb)])
  assert.deepEqual(parseMp4(framed.subarray(13, -7)).samples, avc3.samples.map((sample, index) => ({
    ...sample, cts: [-20, 110, 210][index]
  })), '非零 byteOffset 的 Uint8Array 也必须按自身起点解析')
  console.log('通过：stsz 可变/固定、stz2 4/8/16 位、co64、mdhd v1、ctts v0/v1、VFR、多 stsc、默认关键帧、largesize/size=0、avc3、切片输入')

  for (const [matrix, expected] of [[1, 'bt709'], [5, 'bt601'], [6, 'bt601'], [9, 'bt2020'], [10, 'bt2020'], [2, null], [7, null]] as const) {
    assert.deepEqual(parseMp4(fixture({ description, colr: { type: 'nclx', matrix, fullRange: true } })).color,
      { matrix: expected, fullRange: true })
  }
  assert.deepEqual(parseMp4(fixture({ description, colr: { type: 'nclc', matrix: 6, fullRange: true } })).color,
    { matrix: 'bt601', fullRange: null })
  const hevcDescription = Buffer.alloc(23)
  hevcDescription[0] = 1
  hevcDescription[1] = 0xa2
  hevcDescription.writeUInt32BE(0x60000000, 2)
  hevcDescription.set([0xb0, 0, 0x90, 0, 0, 0], 6)
  hevcDescription[12] = 93
  hevcDescription[21] = 3
  assert.equal(parseMp4(fixture({ description: hevcDescription, sampleType: 'hev1' })).codec, 'hev1.B2.6.H93.B0.00.90')
  console.log('通过：nclx 全部矩阵映射、nclc 空 fullRange、HEVC profile space/tier/compatibility 位反转/constraint 尾零裁剪')

  const spsDescription = complexSpsDescription()
  assert.deepEqual(parseMp4(fixture({ description: spsDescription })).color, { matrix: 'bt2020', fullRange: true })
  assert.deepEqual(parseMp4(fixture({
    description: spsDescription, colr: { type: 'nclx', matrix: 2, fullRange: false }
  })).color, { matrix: null, fullRange: false }, 'nclx unspecified 仍优先于 SPS 中的 bt2020')
  const incompleteSps = Buffer.from([1, 244, 0, 40, 0xff, 0xe1, 0, 1, 0x67, 0])
  assert.deepEqual(parseMp4(fixture({ description: incompleteSps })).color, { matrix: null, fullRange: null })
  console.log('通过：高 profile SPS 的 chroma=3、12 个 scaling_list、POC=1、交错扫描、裁剪、扩展 SAR、overscan、VUI，以及损坏 SPS 回退和 colr 优先级')

  assert.throws(() => parseMp4(new Uint8Array([1, 2, 3])), /不是 MP4 \/ MOV 文件/)
  assert.throws(() => parseMp4(box('moov')), /没有视频轨/)
  assert.throws(() => parseMp4(Buffer.concat([box('moov'), box('moof')])), /不支持分段 MP4（fragmented）/)
  assert.throws(() => parseMp4(fixture({ description, sampleType: 'vp09' })), /不支持的视频编码：vp09，请导出为 H\.264 或 HEVC/)
  const broken = fixture({ description })
  broken.writeUInt32BE(broken.length + 1, 0)
  assert.throws(() => parseMp4(broken), Error)
  console.log('通过：无效文件、没有视频轨、fragmented、未知编码、越界 box 拒绝')
}

const sourceBytes = readFileSync(sourcePath)
const source = parseMp4(sourceBytes)
assert.equal(source.samples.length, 150)
assert.equal(source.width, 1440)
assert.equal(source.height, 1440)
assert.equal(source.fps, 30)
assert.match(source.codec, /^avc1\.64/)
assert.equal(source.color.matrix, null)
const sourceKeyframes = checkPackets(sourcePath, source)
console.log(`通过：wan3_run_swordsman.mp4，150 帧，1440×1440，30 fps，${source.codec}，matrix=null；逐包 offset/size/关键帧一致，关键帧索引=${sourceKeyframes.join(',')}`)

const directory = mkdtempSync(join(tmpdir(), 'gp-mp4-'))
try {
  const hevcPath = join(directory, 'hevc-bt709.mp4')
  const h264Path = join(directory, 'h264-bt601-full.mp4')
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=12', '-frames:v', '12', '-an']
  run('ffmpeg', [
    ...common, '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:pools=1:frame-threads=1',
    '-tag:v', 'hvc1', '-g', '6', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_range', 'tv',
    '-movflags', '+write_colr', hevcPath
  ])
  run('ffmpeg', [
    ...common, '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-g', '6', '-bf', '2',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt470bg', '-color_range', 'pc', '-movflags', '+write_colr', h264Path
  ])
  const hevcBytes = readFileSync(hevcPath)
  const hevc = parseMp4(hevcBytes)
  assert.match(hevc.codec, /^hvc1\./)
  assert.equal(hevc.samples.length, 12)
  assert.equal(hevc.fps, 12)
  assert.equal(hevc.width, 64)
  assert.equal(hevc.height, 64)
  assert.deepEqual(hevc.color, { matrix: 'bt709', fullRange: false })
  checkPackets(hevcPath, hevc)
  assert.deepEqual(parseMp4(withoutColr(hevcBytes)).color, { matrix: null, fullRange: null })
  console.log(`通过：现场生成 HEVC，12 帧，${hevc.codec}，bt709/limited；逐包一致，移除 colr 后色彩为空`)

  const h264Bytes = readFileSync(h264Path)
  const h264 = parseMp4(h264Bytes)
  assert.match(h264.codec, /^avc1\./)
  assert.equal(h264.samples.length, 12)
  assert.equal(h264.fps, 12)
  assert.deepEqual(h264.color, { matrix: 'bt601', fullRange: true })
  checkPackets(h264Path, h264)
  assert.deepEqual(parseMp4(withoutColr(h264Bytes)).color, { matrix: 'bt601', fullRange: true })
  console.log(`通过：现场生成 H.264，12 帧，${h264.codec}，bt601/full；逐包一致，移除 colr 后 SPS VUI 回退一致`)

  checkSynthetic(source.description)
  console.log('全部 MP4 / MOV 解封装测试通过')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
