// Generates the two placeholder PWA icons (192x192, 512x512): dark navy
// background (#0f1923), "FS" in acid green (#00f5a0), drawn with a tiny
// hand-rolled bitmap font since no image/canvas library is available.
// Pure Node + zlib — no dependencies.
//
// Usage: node scripts/generate-icons.js

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BG = [0x0f, 0x19, 0x23]
const FG = [0x00, 0xf5, 0xa0]

// 5x7 bitmap font, 1 = foreground pixel.
const FONT = {
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
}

function buildPixelGrid(size) {
  const grid = Array.from({ length: size }, () => Array(size).fill(false))
  const letters = ['F', 'S']
  const glyphW = 5
  const glyphH = 7
  const gap = 1
  const scale = Math.max(1, Math.floor(size / ((glyphW * 2 + gap) * 2)))
  const totalW = (glyphW * 2 + gap) * scale
  const totalH = glyphH * scale
  const startX = Math.floor((size - totalW) / 2)
  const startY = Math.floor((size - totalH) / 2)

  letters.forEach((letter, li) => {
    const pattern = FONT[letter]
    for (let row = 0; row < glyphH; row++) {
      for (let col = 0; col < glyphW; col++) {
        if (pattern[row][col] !== '1') continue
        const baseX = startX + li * (glyphW + gap) * scale + col * scale
        const baseY = startY + row * scale
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = baseX + dx
            const y = baseY + dy
            if (x >= 0 && x < size && y >= 0 && y < size) grid[y][x] = true
          }
        }
      }
    }
  })

  return grid
}

function crcTable() {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

function crc32Buf(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32Buf(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function encodePng(size) {
  const grid = buildPixelGrid(size)

  // Raw scanlines: filter byte 0 + RGB per pixel.
  const raw = Buffer.alloc((1 + size * 3) * size)
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const color = grid[y][x] ? FG : BG
      raw[offset++] = color[0]
      raw[offset++] = color[1]
      raw[offset++] = color[2]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw)

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [192, 512]) {
  const png = encodePng(size)
  const outPath = path.join(__dirname, '..', 'public', `icon-${size}.png`)
  writeFileSync(outPath, png)
  console.log(`Wrote ${outPath} (${png.length} bytes)`)
}
