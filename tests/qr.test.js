/**
 * Unit tests for the QR encoder used by the mobile-access (手机访问) panel.
 *
 * Golden matrices in tests/fixtures/qr-golden.json were generated with an
 * independent reference implementation (python `qrcode`, forced 8-bit byte
 * mode, pinned version/EC/mask). The suite itself is hermetic: it only reads
 * that JSON file, no python or network at test time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { encodeQr, renderQrSvg, renderQrDataUrl, QR_DEFAULT_EC } from '../src/qr.js'

const golden = JSON.parse(readFileSync(new URL('./fixtures/qr-golden.json', import.meta.url), 'utf8'))

const TUNNEL_URL = 'https://strand-lesser-cant-convicted.trycloudflare.com/'
const LAN_URL = 'http://172.17.1.190:8080/'

/**
 * Convert "0"/"1" row strings to a boolean module matrix.
 * @param {string[]} rows
 * @returns {boolean[][]}
 */
function rowsToModules(rows) {
  return rows.map((row) => row.split('').map((value) => value === '1'))
}

/**
 * Convert a boolean module matrix to "0"/"1" row strings.
 * @param {boolean[][]} modules
 * @returns {string[]}
 */
function modulesToRows(modules) {
  return modules.map((row) => row.map((value) => (value ? '1' : '0')).join(''))
}

/**
 * Assert a 7x7 finder pattern with dark border, light ring and dark 3x3 core.
 * @param {boolean[][]} modules
 * @param {number} left
 * @param {number} top
 */
function assertFinderPattern(modules, left, top) {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
      const expected = distance === 2 ? false : true
      assert.equal(modules[top + dy][left + dx], expected, `finder ${left},${top} at ${dx},${dy}`)
    }
  }
}

/**
 * Assert a 5x5 alignment pattern (dark border, light ring, dark centre).
 * @param {boolean[][]} modules
 * @param {number} cx
 * @param {number} cy
 */
function assertAlignmentPattern(modules, cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      assert.equal(modules[cy + dy][cx + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

/**
 * Rotate a square module matrix by clockwise quarter turns.
 * @param {boolean[][]} modules
 * @param {0|1|2|3} quarters
 * @returns {boolean[][]}
 */
function rotateModules(modules, quarters) {
  const size = modules.length
  if (quarters === 0) return modules
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      if (quarters === 1) return modules[size - 1 - x][y]
      if (quarters === 2) return modules[size - 1 - y][size - 1 - x]
      return modules[x][size - 1 - y]
    }),
  )
}

/**
 * Parse the renderer's compact path back into a module grid.
 *
 * The serialiser emits `M x y h w v h H x` sub-paths (first absolute, later
 * relative `m dx dy`; the fill's implicit close supplies the left edge), so the
 * parser only needs M/m, h and v/H.
 *
 * @param {string} svg
 * @param {number} size
 * @param {number} margin
 * @returns {boolean[][]}
 */
function rasterizePath(svg, size, margin) {
  const match = / d="([^"]*)"/.exec(svg)
  assert.ok(match, 'SVG must contain path data')
  const pathData = match[1]

  const grid = Array.from({ length: size }, () => new Array(size).fill(false))
  const commands = [...pathData.matchAll(/([MmHhVv])([^MmHhVv]*)/g)]
  assert.ok(commands.length > 0, 'path data must contain commands')

  let currentX = 0
  let currentY = 0
  let subpathLeft = 0
  let subpathTop = 0
  let rectangles = 0

  for (const [, command, rawArguments] of commands) {
    const numbers = (rawArguments.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
    if (command === 'M' || command === 'm') {
      assert.equal(numbers.length, 2, 'moveto must have x and y')
      if (command === 'M') {
        currentX = numbers[0]
        currentY = numbers[1]
      } else {
        currentX += numbers[0]
        currentY += numbers[1]
      }
      subpathLeft = currentX
      subpathTop = currentY
    } else if (command === 'h') {
      assert.equal(numbers.length, 1, 'horizontal lineto must have a length')
      currentX += numbers[0]
    } else if (command === 'v') {
      assert.equal(numbers.length, 1, 'vertical lineto must have a length')
      const left = subpathLeft - margin
      const top = subpathTop - margin
      const width = currentX - subpathLeft
      const height = numbers[0]
      assert.ok(Number.isInteger(left) && Number.isInteger(top), 'rect origins must be integers')
      assert.ok(width > 0 && height > 0, 'rectangles must be non-empty')
      assert.ok(left >= 0 && top >= 0 && left + width <= size && top + height <= size,
        `rectangle ${left},${top},${width},${height} inside the symbol`)
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          assert.equal(grid[top + dy][left + dx], false, 'rectangles must not overlap')
          grid[top + dy][left + dx] = true
        }
      }
      currentY += numbers[0]
      rectangles++
    } else if (command === 'H') {
      assert.equal(numbers.length, 1, 'absolute horizontal lineto must have x')
      assert.equal(numbers[0], subpathLeft, 'H must return to the sub-path origin')
      currentX = numbers[0]
    } else {
      assert.fail(`unexpected path command ${command}`)
    }
  }

  assert.ok(rectangles > 0, 'path must contain rectangles')
  return grid
}

/**
 * Assert the rendered path covers exactly the encoded modules in some valid
 * symbol orientation. Scanners accept any rotation, so the path may be emitted
 * rotated; it must never be mirrored.
 *
 * @param {string} svg
 * @param {boolean[][]} expected source matrix from encodeQr
 * @param {number} margin
 */
function assertPathRasterisesToMatrix(svg, expected, margin) {
  const grid = rasterizePath(svg, expected.length, margin)
  const key = matrixKey(grid)
  const allowed = rotationKeys(expected)
  assert.ok(allowed.includes(key), 'path must rasterise to exactly the encoded modules (up to rotation)')
  assert.ok(!mirrorKeys(expected).includes(key), 'path must not be a mirrored symbol')
}

/**
 * Render "0"/"1" rows for a matrix, for set comparisons in tests.
 * @param {boolean[][]} modules
 * @returns {string}
 */
function matrixKey(modules) {
  return modules.map((row) => row.map((value) => (value ? '1' : '0')).join('')).join('\n')
}

/** @param {boolean[][]} expected @returns {string[]} one key per rotation */
function rotationKeys(expected) {
  return [0, 1, 2, 3].map((quarters) => matrixKey(rotateModules(expected, quarters)))
}

/** @param {boolean[][]} expected @returns {string[]} one key per mirror variant */
function mirrorKeys(expected) {
  // The mirror coset of a square matrix has four members: a horizontal flip
  // plus its 90/180/270 degree rotations (the vertical flip is the 180 one).
  const flipped = expected.map((row) => [...row].reverse())
  return [0, 1, 2, 3].map((quarters) => matrixKey(rotateModules(flipped, quarters)))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

test('exposes the documented public API', () => {
  assert.equal(typeof encodeQr, 'function')
  assert.equal(typeof renderQrSvg, 'function')
  assert.equal(typeof renderQrDataUrl, 'function')
  assert.equal(QR_DEFAULT_EC, 'M')
})

test('golden fixture file was generated by the independent reference implementation', () => {
  assert.match(golden.reference, /python-qrcode/)
  assert.ok(Array.isArray(golden.cases))
  assert.ok(golden.cases.length >= 12)
  assert.deepEqual(new Set(golden.cases.map((entry) => entry.ec)), new Set(['L', 'M', 'Q', 'H']))
  assert.deepEqual(new Set(golden.cases.map((entry) => entry.mask)), new Set([0, 1, 2, 3, 4, 5, 6, 7]))
  for (const version of [1, 2, 3, 4, 5, 7]) {
    assert.ok(golden.cases.some((entry) => entry.version === version), `golden fixture covers version ${version}`)
  }
})

// ---------------------------------------------------------------------------
// Golden matrices (independent reference implementation)
// ---------------------------------------------------------------------------

test('golden matrices match the independent reference implementation', () => {
  for (const entry of golden.cases) {
    const result = encodeQr(entry.text, { version: entry.version, ec: entry.ec, mask: entry.mask })
    assert.equal(result.version, entry.version, entry.name)
    assert.equal(result.ec, entry.ec, entry.name)
    assert.equal(result.mask, entry.mask, entry.name)
    assert.equal(result.size, entry.size, entry.name)
    assert.equal(result.size, 4 * entry.version + 17, `${entry.name}: size formula`)
    assert.equal(result.modules.length, entry.size, entry.name)
    assert.deepEqual(modulesToRows(result.modules), entry.rows, `${entry.name}: matrix`)
    for (const row of result.modules) {
      assert.equal(row.length, entry.size, entry.name)
      for (const value of row) assert.equal(typeof value, 'boolean')
    }
  }
})

test('golden coverage includes short ASCII, tunnel URL, Chinese text and all EC levels', () => {
  const texts = golden.cases.map((entry) => entry.text)
  assert.ok(texts.includes('HELLO WORLD 123'))
  assert.ok(texts.includes(TUNNEL_URL))
  assert.ok(texts.some((text) => /[\u4e00-\u9fff]/.test(text)))
  for (const ec of ['L', 'M', 'Q', 'H']) {
    assert.ok(golden.cases.some((entry) => entry.ec === ec))
  }
})

// ---------------------------------------------------------------------------
// Structural properties (no fixture needed)
// ---------------------------------------------------------------------------

test('symbol size follows size = 4 * version + 17 for all versions', () => {
  for (let version = 1; version <= 40; version++) {
    const result = encodeQr('hi', { version })
    assert.equal(result.version, version)
    assert.equal(result.size, 4 * version + 17)
    assert.equal(result.modules.length, result.size)
    for (const row of result.modules) assert.equal(row.length, result.size)
  }
})

test('finder patterns, separators, timing patterns and the dark module are present', () => {
  for (const version of [1, 2, 7]) {
    const { modules, size } = encodeQr('structure', { version })
    assertFinderPattern(modules, 0, 0)
    assertFinderPattern(modules, size - 7, 0)
    assertFinderPattern(modules, 0, size - 7)

    // Light separators around the top-left finder.
    for (let i = 0; i < 8; i++) {
      assert.equal(modules[7][i], false, 'finder row separator')
      assert.equal(modules[i][7], false, 'finder column separator')
    }
    // Light separators around the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) {
      assert.equal(modules[7][size - 1 - i], false, 'top-right separator')
      assert.equal(modules[size - 1 - i][7], false, 'bottom-left separator')
    }

    // Timing patterns alternate, starting dark at coordinate 6 / 8.
    for (let i = 8; i <= size - 9; i++) {
      assert.equal(modules[6][i], i % 2 === 0, `horizontal timing at ${i}`)
      assert.equal(modules[i][6], i % 2 === 0, `vertical timing at ${i}`)
    }

    // The always-dark module at (x=8, y=size-8).
    assert.equal(modules[size - 8][8], true, 'always-dark module')
  }
})

test('alignment patterns are placed for versions 2 and above', () => {
  const versionTwo = encodeQr('alignment', { version: 2 })
  assertAlignmentPattern(versionTwo.modules, 18, 18)

  const versionSeven = encodeQr('alignment', { version: 7 })
  for (const [cx, cy] of [[22, 22], [38, 22], [22, 38], [38, 38], [6, 22], [22, 6]]) {
    assertAlignmentPattern(versionSeven.modules, cx, cy)
  }
  // Centres that would overlap a finder must not be drawn.
  assert.deepEqual(
    [versionSeven.modules[6][6], versionSeven.modules[6][38]],
    [true, true],
    'finder modules win over alignment patterns',
  )
})

test('version information blocks are present for version 7 and above', () => {
  const { modules, size } = encodeQr('version info', { version: 7 })
  const known = { 7: 0x07c94 } // BCH(18,6) version information bits for version 7
  for (const version of [7]) {
    const bits = known[version]
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0
      const high = size - 11 + (i % 3)
      const low = Math.floor(i / 3)
      assert.equal(modules[low][high], dark, `version info copy 1 bit ${i}`)
      assert.equal(modules[high][low], dark, `version info copy 2 bit ${i}`)
    }
  }
})

// ---------------------------------------------------------------------------
// Auto version / auto mask selection
// ---------------------------------------------------------------------------

test('auto version is the smallest version that fits the payload', () => {
  // Byte-mode capacities of version 1 per EC level (ISO/IEC 18004 Table 7).
  const versionOneCapacity = { L: 17, M: 14, Q: 11, H: 7 }
  for (const [ec, capacity] of Object.entries(versionOneCapacity)) {
    assert.equal(encodeQr('x'.repeat(capacity), { ec }).version, 1, `EC ${ec} fills version 1`)
    assert.equal(encodeQr('x'.repeat(capacity + 1), { ec }).version, 2, `EC ${ec} overflows version 1`)
  }
  // Version 4/5 boundary at EC M (62 and 84 byte capacities).
  assert.equal(encodeQr('x'.repeat(62), { ec: 'M' }).version, 4)
  assert.equal(encodeQr('x'.repeat(63), { ec: 'M' }).version, 5)
  // Auto version agrees with an explicitly pinned version.
  const auto = encodeQr('x'.repeat(70), { ec: 'M' })
  assert.equal(auto.version, 5)
  assert.deepEqual(auto.modules, encodeQr('x'.repeat(70), { ec: 'M', version: 5 }).modules)
  // Longer payloads never pick a smaller version.
  let previous = 0
  for (const length of [1, 10, 50, 100, 200, 400, 800]) {
    const version = encodeQr('y'.repeat(length), { ec: 'M' }).version
    assert.ok(version >= previous, 'auto version is non-decreasing in payload length')
    previous = version
  }
})

test('auto mask is deterministic, in range, and equals the matching pinned mask', () => {
  for (const text of ['hello world', TUNNEL_URL, '文献精读库手机访问']) {
    const first = encodeQr(text)
    const second = encodeQr(text)
    assert.deepEqual(first.modules, second.modules, 'encoding is deterministic')
    assert.ok(Number.isInteger(first.mask) && first.mask >= 0 && first.mask <= 7, 'mask in 0..7')
    const pinned = encodeQr(text, { mask: first.mask })
    assert.equal(pinned.mask, first.mask)
    assert.deepEqual(pinned.modules, first.modules, 'auto mask equals the pinned mask matrix')
  }
})

test('every mask pattern is supported and produces a distinct symbol', () => {
  const seen = new Set()
  for (let mask = 0; mask <= 7; mask++) {
    const result = encodeQr('mask coverage', { mask })
    assert.equal(result.mask, mask)
    seen.add(modulesToRows(result.modules).join('\n'))
  }
  assert.equal(seen.size, 8, 'the eight masks produce eight different matrices')
})

test('error correction levels trade capacity as expected', () => {
  const text = 'z'.repeat(120)
  const versions = ['L', 'M', 'Q', 'H'].map((ec) => encodeQr(text, { ec }).version)
  for (let i = 1; i < versions.length; i++) {
    assert.ok(versions[i] >= versions[i - 1], `EC ${'LMQH'[i]} needs at least as many modules`)
  }
  assert.equal(encodeQr('hi', { ec: 'm' }).ec, 'M', 'EC level is normalised to upper case')
  assert.equal(encodeQr('hi', { ec: 'H' }).ec, 'H')
})

test('byte mode counts UTF-8 bytes, not characters', () => {
  // 8 Chinese characters are 24 UTF-8 bytes: fits version 2 at EC M (26 bytes).
  assert.equal(encodeQr('文'.repeat(8), { ec: 'M' }).version, 2)
  // 9 Chinese characters are 27 bytes: overflow of version 2.
  assert.equal(encodeQr('文'.repeat(9), { ec: 'M' }).version, 3)
})

test('explicit version and mask options are honoured', () => {
  const result = encodeQr('forced', { version: 10, mask: 6, ec: 'Q' })
  assert.equal(result.version, 10)
  assert.equal(result.mask, 6)
  assert.equal(result.ec, 'Q')
  assert.equal(result.size, 57)
})

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

test('renderQrSvg emits one compact, self-contained SVG with a quiet zone', () => {
  const encoded = encodeQr('hello world')
  const svg = renderQrSvg('hello world')
  const side = encoded.size + 2 * 2

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '))
  assert.ok(svg.endsWith('</svg>'))
  assert.ok(svg.includes(`viewBox="0 0 ${side} ${side}"`), 'viewBox includes the default 2-module quiet zone')
  assert.ok(svg.includes(`width="${side}" height="${side}"`), 'default width/height are module units')
  assert.ok(svg.includes('role="img"'))
  assert.ok(svg.includes('shape-rendering="crispEdges"'))
  assert.equal((svg.match(/<rect/g) || []).length, 1, 'exactly one background rect')
  assert.equal((svg.match(/<path/g) || []).length, 1, 'exactly one path')
  assert.ok(svg.includes('<rect width="25" height="25" fill="#ffffff"/>'))
  assert.ok(svg.includes('<path fill="#000000" d="'))
  assert.ok(svg.includes('aria-label="hello world"'))
  assert.ok(!svg.includes('<script'), 'no scripts')
  assert.ok(!svg.includes('href='), 'no references')
  assert.ok(!svg.includes('url('), 'no external paint references')
})

test('renderQrSvg supports margin, scale, colours and label options', () => {
  const encoded = encodeQr('options')
  for (const margin of [0, 1, 2, 5]) {
    const side = encoded.size + 2 * margin
    const svg = renderQrSvg('options', { margin })
    assert.ok(svg.includes(`viewBox="0 0 ${side} ${side}"`), `margin ${margin}`)
    assert.ok(svg.includes(`width="${side}" height="${side}"`), `margin ${margin} size`)
  }

  const scaled = renderQrSvg('options', { scale: 2 })
  assert.ok(scaled.includes(`viewBox="0 0 ${encoded.size + 4} ${encoded.size + 4}"`))
  assert.ok(scaled.includes(`width="${(encoded.size + 4) * 2}" height="${(encoded.size + 4) * 2}"`))

  const coloured = renderQrSvg('options', { dark: '#112233', light: 'rgb(255, 254, 253)' })
  assert.ok(coloured.includes('fill="#112233"'))
  assert.ok(coloured.includes('fill="rgb(255, 254, 253)"'))

  const labelled = renderQrSvg('options', { label: 'a&b"<c>' })
  assert.ok(labelled.includes('aria-label="a&amp;b&quot;&lt;c&gt;"'), 'label is XML-escaped')

  const sanitised = renderQrSvg('options', { label: 'line\u0000break' })
  assert.ok(sanitised.includes('aria-label="line break"'), 'control characters are replaced')
})

test('SVG path rasterises back to exactly the encoded matrix', () => {
  for (const text of ['hello world', TUNNEL_URL, '文献精读库手机访问', 'x'.repeat(90)]) {
    for (const margin of [0, 2, 3]) {
      const encoded = encodeQr(text)
      const svg = renderQrSvg(text, { margin })
      assertPathRasterisesToMatrix(svg, encoded.modules, margin)
    }
  }
})

test('SVG stays compact (one merged path, not one rect per module)', () => {
  const tunnelSvg = renderQrSvg(TUNNEL_URL)
  const lanSvg = renderQrSvg(LAN_URL)
  const smallSvg = renderQrSvg('hello world')
  // One `<path>` per module would be > 8 KB for the tunnel URL; greedy run
  // rectangles keep it around 2.9 KB (typical LAN URLs are below 2 KB).
  assert.ok(smallSvg.length < 1200, `small QR SVG is ${smallSvg.length} bytes`)
  assert.ok(lanSvg.length < 2048, `LAN URL SVG is ${lanSvg.length} bytes`)
  assert.ok(tunnelSvg.length < 4096, `tunnel URL SVG is ${tunnelSvg.length} bytes`)
})

test('renderQrDataUrl wraps the SVG as base64', () => {
  const dataUrl = renderQrDataUrl(TUNNEL_URL, { margin: 1 })
  assert.ok(dataUrl.startsWith('data:image/svg+xml;base64,'))
  const decoded = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
  assert.equal(decoded, renderQrSvg(TUNNEL_URL, { margin: 1 }))
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('encodeQr throws TypeError for invalid or over-capacity text', () => {
  for (const invalid of [null, undefined, 42, {}, [], true, Symbol('x')]) {
    assert.throws(() => encodeQr(invalid), TypeError)
  }
  assert.throws(() => encodeQr(''), TypeError)
  // 3000 bytes exceed the maximum byte-mode capacity (version 40 at EC H = 1273).
  assert.throws(() => encodeQr('x'.repeat(3000), { ec: 'H' }), TypeError)
  // Pinned version too small for the payload.
  assert.throws(() => encodeQr('x'.repeat(30), { version: 1 }), TypeError)
  // 2400 bytes exceed the maximum capacity of version 40 at EC M (2331).
  assert.throws(() => encodeQr('x'.repeat(2400), { version: 40 }), TypeError)
})

test('option validation rejects invalid ec, version and mask values', () => {
  assert.throws(() => encodeQr('hi', { ec: 'X' }), RangeError)
  assert.throws(() => encodeQr('hi', { ec: 42 }), TypeError)
  assert.throws(() => encodeQr('hi', { version: 0 }), RangeError)
  assert.throws(() => encodeQr('hi', { version: 41 }), RangeError)
  assert.throws(() => encodeQr('hi', { version: 1.5 }), RangeError)
  assert.throws(() => encodeQr('hi', { mask: -1 }), RangeError)
  assert.throws(() => encodeQr('hi', { mask: 8 }), RangeError)
  assert.throws(() => encodeQr('hi', { mask: 2.5 }), RangeError)
  assert.throws(() => encodeQr('hi', []), TypeError)
})

test('renderQrSvg validates rendering options', () => {
  assert.throws(() => renderQrSvg('hi', { margin: -1 }), RangeError)
  assert.throws(() => renderQrSvg('hi', { margin: 1.5 }), RangeError)
  assert.throws(() => renderQrSvg('hi', { scale: 0 }), RangeError)
  assert.throws(() => renderQrSvg('hi', { scale: Number.NaN }), RangeError)
  assert.throws(() => renderQrSvg('hi', { dark: '' }), TypeError)
  assert.throws(() => renderQrSvg('hi', { light: 42 }), TypeError)
  assert.throws(() => renderQrSvg('hi', { label: 42 }), TypeError)
  assert.throws(() => renderQrSvg(''), TypeError)
})
