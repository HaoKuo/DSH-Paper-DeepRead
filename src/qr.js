/**
 * QR Code Model 2 encoder and compact SVG renderer.
 *
 * Pure Node module: no I/O, no timers, no dependencies. The plugin mobile-access
 * panel needs scannable QR codes for access URLs, and the host side must hand
 * the browser ready-to-inject SVG markup, so this module encodes the matrix
 * itself and serialises it as a single `<path>`.
 *
 * Scope: Model 2 symbols, byte mode only (the payload is a UTF-8 URL), error
 * correction levels L/M/Q/H, versions 1..40. The version is chosen as the
 * smallest one that fits the payload unless the caller pins one; the mask is
 * chosen with the four ISO penalty rules (N1..N4) unless the caller pins one.
 * Pinning `version`/`mask` exists for tests and golden-matrix fixtures.
 *
 * The encoder writes function patterns, Reed-Solomon error correction over
 * GF(256) with the 0x11D primitive polynomial, block interleaving, format
 * information (BCH 15,5) and version information (BCH 18,6) for versions >= 7.
 *
 * @module dsh-paper-deepread/qr
 */

/** Default error correction level used by the access feature. */
export const QR_DEFAULT_EC = 'M'

/** Error correction levels in specification order (weakest to strongest). */
const EC_LEVELS = ['L', 'M', 'Q', 'H']

/** Format-information bits for each error correction level (ISO Table 12). */
const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }

/**
 * Error correction codewords per block, indexed by EC level then version-1.
 * Values are from ISO/IEC 18004 Table 9 (cross-checked against python `qrcode`).
 */
const ECC_CODEWORDS_PER_BLOCK = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
}

/**
 * Number of error correction blocks, indexed by EC level then version-1.
 * Values are from ISO/IEC 18004 Table 9 (cross-checked against python `qrcode`).
 */
const NUM_ERROR_CORRECTION_BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
}

/**
 * Alignment pattern centre coordinates, indexed by version-1
 * (ISO/IEC 18004 Annex E). Version 1 has no alignment patterns.
 */
const ALIGNMENT_PATTERN_POSITIONS = [
  [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
]

/** Mask patterns 0..7, as predicates over (x, y) module coordinates. */
const MASK_PATTERNS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** Finder-like patterns scored by penalty rule N3. */
const N3_PATTERNS = ['10111010000', '00001011101'].map((pattern) => pattern.split('').map(Number))

// ---------------------------------------------------------------------------
// GF(256) arithmetic for Reed-Solomon error correction.
// The field uses the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let value = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value
    GF_LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}

/**
 * Multiply two GF(256) elements.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gfMultiply(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/**
 * Compute the Reed-Solomon generator polynomial coefficients.
 * @param {number} degree number of error correction codewords
 * @returns {Uint8Array} coefficients in descending order
 */
function reedSolomonDivisor(degree) {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

/**
 * Compute Reed-Solomon error correction codewords for one block.
 * @param {number[]} data data codewords
 * @param {Uint8Array} divisor generator polynomial
 * @returns {Uint8Array}
 */
function reedSolomonRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length)
  for (const byte of data) {
    const factor = byte ^ result[0]
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < result.length; i++) result[i] ^= gfMultiply(divisor[i], factor)
  }
  return result
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Number of data modules (including remainder bits) available in a version.
 * @param {number} version 1..40
 * @returns {number}
 */
function getRawDataModules(version) {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

/**
 * Number of data codewords (bytes) available for one version and EC level.
 * @param {number} version 1..40
 * @param {'L'|'M'|'Q'|'H'} ec
 * @returns {number}
 */
function getNumDataCodewords(version, ec) {
  const totalCodewords = Math.floor(getRawDataModules(version) / 8)
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ec][version - 1]
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ec][version - 1]
  return totalCodewords - eccPerBlock * numBlocks
}

/**
 * Bit count needed to encode a byte-mode payload in a given version.
 * Returns Infinity when the payload length cannot be expressed in the
 * version's character count indicator.
 * @param {number} version
 * @param {number} byteLength
 * @returns {number}
 */
function getByteModeBitLength(version, byteLength) {
  const countBits = version <= 9 ? 8 : 16
  if (byteLength >>> countBits !== 0) return Infinity
  return 4 + countBits + byteLength * 8
}

/**
 * Smallest version that fits a byte-mode payload, or null when it never fits.
 * @param {number} byteLength
 * @param {'L'|'M'|'Q'|'H'} ec
 * @returns {number|null}
 */
function findSmallestVersion(byteLength, ec) {
  for (let version = 1; version <= 40; version++) {
    if (getByteModeBitLength(version, byteLength) <= getNumDataCodewords(version, ec) * 8) {
      return version
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Bit stream -> codewords
// ---------------------------------------------------------------------------

/**
 * Append the low `length` bits of `value` to a bit array.
 * @param {number[]} bits
 * @param {number} value
 * @param {number} length
 */
function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

/**
 * Build the padded data codewords for a byte-mode payload.
 * @param {Buffer} bytes UTF-8 payload
 * @param {number} version
 * @param {'L'|'M'|'Q'|'H'} ec
 * @returns {number[]}
 */
function createDataCodewords(bytes, version, ec) {
  const capacityBits = getNumDataCodewords(version, ec) * 8
  const countBits = version <= 9 ? 8 : 16
  const bits = []
  appendBits(bits, 0b0100, 4) // byte mode indicator
  appendBits(bits, bytes.length, countBits)
  for (const byte of bytes) appendBits(bits, byte, 8)
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length)) // terminator
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8)
  const codewords = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }
  return codewords
}

/**
 * Split data codewords into blocks, append error correction and interleave.
 * @param {number[]} data data codewords
 * @param {number} version
 * @param {'L'|'M'|'Q'|'H'} ec
 * @returns {number[]} interleaved codewords
 */
function addEccAndInterleave(data, version, ec) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ec][version - 1]
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ec][version - 1]
  const totalCodewords = Math.floor(getRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (totalCodewords % numBlocks)
  const shortBlockLen = Math.floor(totalCodewords / numBlocks)

  const blocks = []
  const divisor = reedSolomonDivisor(eccPerBlock)
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - eccPerBlock + (i < numShortBlocks ? 0 : 1)
    const blockData = data.slice(offset, offset + dataLen)
    offset += dataLen
    const ecc = reedSolomonRemainder(blockData, divisor)
    if (i < numShortBlocks) blockData.push(0) // placeholder to align interleaving
    blocks.push(blockData.concat(Array.from(ecc)))
  }

  const result = []
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - eccPerBlock || j >= numShortBlocks) result.push(blocks[j][i])
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

/**
 * @typedef {{ size: number, modules: Uint8Array[], isFunction: Uint8Array[] }} MatrixBuffer
 */

/**
 * Write one module and mark it as a function module (never masked, never data).
 * @param {MatrixBuffer} buffer
 * @param {number} x
 * @param {number} y
 * @param {boolean} dark
 */
function setFunctionModule(buffer, x, y, dark) {
  buffer.modules[y][x] = dark ? 1 : 0
  buffer.isFunction[y][x] = 1
}

/**
 * Draw one finder pattern (including its light separator ring).
 * @param {MatrixBuffer} buffer
 * @param {number} cx centre x
 * @param {number} cy centre y
 */
function drawFinderPattern(buffer, cx, cy) {
  const { size } = buffer
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || x >= size || y < 0 || y >= size) continue
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setFunctionModule(buffer, x, y, distance !== 2 && distance !== 4)
    }
  }
}

/**
 * Draw one 5x5 alignment pattern.
 * @param {MatrixBuffer} buffer
 * @param {number} cx centre x
 * @param {number} cy centre y
 */
function drawAlignmentPattern(buffer, cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(buffer, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

/**
 * Draw the 15-bit format information around the top-left finder and the two
 * copies next to the other finders. Also marks the always-dark module.
 * @param {MatrixBuffer} buffer
 * @param {'L'|'M'|'Q'|'H'} ec
 * @param {number} mask
 */
function drawFormatBits(buffer, ec, mask) {
  const { size } = buffer
  const data = (EC_FORMAT_BITS[ec] << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  const bits = ((data << 10) | remainder) ^ 0x5412
  const bit = (index) => ((bits >>> index) & 1) !== 0

  for (let i = 0; i <= 5; i++) setFunctionModule(buffer, 8, i, bit(i))
  setFunctionModule(buffer, 8, 7, bit(6))
  setFunctionModule(buffer, 8, 8, bit(7))
  setFunctionModule(buffer, 7, 8, bit(8))
  for (let i = 9; i < 15; i++) setFunctionModule(buffer, 14 - i, 8, bit(i))

  for (let i = 0; i < 8; i++) setFunctionModule(buffer, size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) setFunctionModule(buffer, 8, size - 15 + i, bit(i))
  setFunctionModule(buffer, 8, size - 8, true)
}

/**
 * Draw the 18-bit version information blocks for versions 7 and above.
 * @param {MatrixBuffer} buffer
 * @param {number} version
 */
function drawVersionBits(buffer, version) {
  if (version < 7) return
  const { size } = buffer
  let remainder = version
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  const bits = (version << 12) | remainder
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0
    const high = size - 11 + (i % 3)
    const low = Math.floor(i / 3)
    setFunctionModule(buffer, high, low, dark)
    setFunctionModule(buffer, low, high, dark)
  }
}

/**
 * Create a matrix with all function patterns drawn and all format/version
 * areas reserved. Data modules are still light.
 * @param {number} version
 * @param {'L'|'M'|'Q'|'H'} ec
 * @returns {MatrixBuffer}
 */
function createBaseMatrix(version, ec) {
  const size = version * 4 + 17
  /** @type {MatrixBuffer} */
  const buffer = {
    size,
    modules: Array.from({ length: size }, () => new Uint8Array(size)),
    isFunction: Array.from({ length: size }, () => new Uint8Array(size)),
  }

  // Timing patterns (row 6 and column 6), then finders overwrite their ends.
  for (let i = 0; i < size; i++) {
    setFunctionModule(buffer, 6, i, i % 2 === 0)
    setFunctionModule(buffer, i, 6, i % 2 === 0)
  }

  drawFinderPattern(buffer, 3, 3)
  drawFinderPattern(buffer, size - 4, 3)
  drawFinderPattern(buffer, 3, size - 4)

  const alignPositions = ALIGNMENT_PATTERN_POSITIONS[version - 1]
  for (let i = 0; i < alignPositions.length; i++) {
    for (let j = 0; j < alignPositions.length; j++) {
      const isFinderCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === alignPositions.length - 1) ||
        (i === alignPositions.length - 1 && j === 0)
      if (!isFinderCorner) drawAlignmentPattern(buffer, alignPositions[j], alignPositions[i])
    }
  }

  // Reserve format/version areas; the actual bits are written per mask later.
  drawFormatBits(buffer, ec, 0)
  drawVersionBits(buffer, version)
  return buffer
}

/**
 * Place the interleaved codewords in the two-module-wide zig-zag pattern.
 * @param {MatrixBuffer} buffer
 * @param {number[]} codewords
 */
function placeCodewords(buffer, codewords) {
  const { size, modules, isFunction } = buffer
  const totalBits = codewords.length * 8
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!isFunction[y][x] && bitIndex < totalBits) {
          modules[y][x] = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1
          bitIndex++
        }
      }
    }
  }
}

/**
 * Apply one mask pattern to all non-function modules.
 * @param {MatrixBuffer} buffer
 * @param {number} mask
 * @param {Uint8Array[]} [target] destination rows (defaults to the buffer)
 */
function applyMask(buffer, mask, target = buffer.modules) {
  const { size, isFunction } = buffer
  const predicate = MASK_PATTERNS[mask]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && predicate(x, y)) target[y][x] ^= 1
    }
  }
}

// ---------------------------------------------------------------------------
// Mask penalty rules (ISO/IEC 18004 section 7.8.3, rules N1..N4)
// ---------------------------------------------------------------------------

/**
 * Score a fully masked matrix with the four penalty rules.
 * Lower is better. Mirrors the reference arithmetic used by ZXing and
 * python `qrcode` (notably N4 uses the floor of the 5% deviation count).
 * @param {Uint8Array[]} modules
 * @param {number} size
 * @returns {number}
 */
function getPenaltyScore(modules, size) {
  let score = 0

  // N1: runs of five or more same-coloured modules in a row or column.
  for (let y = 0; y < size; y++) {
    let run = 1
    for (let x = 1; x <= size; x++) {
      if (x < size && modules[y][x] === modules[y][x - 1]) {
        run++
      } else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1
    for (let y = 1; y <= size; y++) {
      if (y < size && modules[y][x] === modules[y - 1][x]) {
        run++
      } else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
  }

  // N2: every 2x2 block of the same colour.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const color = modules[y][x]
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
        score += 3
      }
    }
  }

  // N3: finder-like 1:1:3:1:1 patterns preceded or followed by four light modules.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 11 <= size; x++) {
      if (matchesN3Pattern(modules, size, x, y, 'row')) score += 40
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y + 11 <= size; y++) {
      if (matchesN3Pattern(modules, size, x, y, 'column')) score += 40
    }
  }

  // N4: 10 points per 5% deviation of the dark-module proportion from 50%.
  let dark = 0
  for (const row of modules) {
    for (const value of row) dark += value
  }
  const total = size * size
  const deviations = Math.floor((Math.abs(2 * dark - total) * 10) / total)
  score += deviations * 10

  return score
}

/**
 * Test the two N3 patterns starting at a row/column offset.
 * @param {Uint8Array[]} modules
 * @param {number} size
 * @param {number} x
 * @param {number} y
 * @param {'row'|'column'} direction
 * @returns {boolean}
 */
function matchesN3Pattern(modules, size, x, y, direction) {
  for (const pattern of N3_PATTERNS) {
    let matched = true
    for (let i = 0; i < 11; i++) {
      const value = direction === 'row' ? modules[y][x + i] : modules[y + i][x]
      if (value !== pattern[i]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Option validation helpers
// ---------------------------------------------------------------------------

/**
 * @param {unknown} options
 * @returns {object}
 */
function readOptions(options) {
  if (options === undefined || options === null) return {}
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object')
  return options
}

/**
 * Normalise an error correction level.
 * @param {unknown} ec
 * @returns {'L'|'M'|'Q'|'H'}
 */
function normalizeEc(ec) {
  if (ec === undefined || ec === null) return QR_DEFAULT_EC
  if (typeof ec !== 'string') throw new TypeError('ec must be a string')
  const level = ec.toUpperCase()
  if (!EC_LEVELS.includes(level)) throw new RangeError(`ec must be one of ${EC_LEVELS.join(', ')}`)
  return /** @type {'L'|'M'|'Q'|'H'} */ (level)
}

/**
 * Normalise an optional version override.
 * @param {unknown} version
 * @returns {number|undefined}
 */
function normalizeVersion(version) {
  if (version === undefined || version === null) return undefined
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new RangeError('version must be an integer between 1 and 40')
  }
  return version
}

/**
 * Normalise an optional mask override.
 * @param {unknown} mask
 * @returns {number|undefined}
 */
function normalizeMask(mask) {
  if (mask === undefined || mask === null) return undefined
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError('mask must be an integer between 0 and 7')
  }
  return mask
}

/**
 * Validate the payload and return its UTF-8 bytes.
 * @param {unknown} text
 * @returns {Buffer}
 */
function textToBytes(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string')
  if (text.length === 0) throw new TypeError('text must not be empty')
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length === 0) throw new TypeError('text must not be empty')
  return bytes
}

// ---------------------------------------------------------------------------
// Public encoder
// ---------------------------------------------------------------------------

/**
 * Encode text as a QR Code Model 2 symbol in byte mode (UTF-8).
 *
 * @param {string} text payload; must be a non-empty string that fits a version 40 symbol
 * @param {{ ec?: 'L'|'M'|'Q'|'H', version?: number, mask?: number }} [options]
 *   `version`/`mask` pin the symbol version (1..40) and mask pattern (0..7);
 *   by default the smallest fitting version and the lowest-penalty mask are used.
 * @returns {{ version: number, size: number, ec: 'L'|'M'|'Q'|'H', mask: number, modules: boolean[][] }}
 *   `modules` is row-major: `modules[y][x] === true` means a dark module.
 * @throws {TypeError} when `text` is not a non-empty string or exceeds capacity
 * @throws {RangeError} when `ec`, `version` or `mask` is not a permitted value
 */
export function encodeQr(text, options = {}) {
  const opts = readOptions(options)
  const ec = normalizeEc(opts.ec)
  const forcedVersion = normalizeVersion(opts.version)
  const forcedMask = normalizeMask(opts.mask)
  const bytes = textToBytes(text)

  const smallestVersion = findSmallestVersion(bytes.length, ec)
  if (smallestVersion === null) {
    throw new TypeError(`text is too long for a QR code (${bytes.length} bytes at EC ${ec})`)
  }

  const version = forcedVersion === undefined ? smallestVersion : forcedVersion
  if (getByteModeBitLength(version, bytes.length) > getNumDataCodewords(version, ec) * 8) {
    throw new TypeError(
      `text is too long for QR version ${version} at EC ${ec} (${bytes.length} bytes)`,
    )
  }

  const dataCodewords = createDataCodewords(bytes, version, ec)
  const codewords = addEccAndInterleave(dataCodewords, version, ec)
  const buffer = createBaseMatrix(version, ec)
  placeCodewords(buffer, codewords)

  const masks = forcedMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask]
  let chosenMask = masks[0]
  let chosenModules = null
  let bestPenalty = Infinity
  for (const mask of masks) {
    const candidate = buffer.modules.map((row) => row.slice())
    applyMask(buffer, mask, candidate)
    drawFormatBits({ size: buffer.size, modules: candidate, isFunction: buffer.isFunction }, ec, mask)
    if (forcedMask !== undefined) {
      chosenMask = mask
      chosenModules = candidate
      break
    }
    const penalty = getPenaltyScore(candidate, buffer.size)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      chosenMask = mask
      chosenModules = candidate
    }
  }

  return {
    version,
    size: buffer.size,
    ec,
    mask: chosenMask,
    modules: chosenModules.map((row) => Array.from(row, (value) => value === 1)),
  }
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/**
 * Normalise the quiet-zone size (modules on each side).
 * @param {unknown} margin
 * @returns {number}
 */
function normalizeMargin(margin) {
  if (margin === undefined || margin === null) return 2
  if (!Number.isInteger(margin) || margin < 0) throw new RangeError('margin must be a non-negative integer')
  return margin
}

/**
 * Normalise the optional pixel scale.
 * @param {unknown} scale
 * @returns {number|undefined}
 */
function normalizeScale(scale) {
  if (scale === undefined || scale === null) return undefined
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('scale must be a positive finite number')
  }
  return scale
}

/**
 * Normalise a colour option (any CSS colour string is passed through).
 * @param {unknown} color
 * @param {string} fallback
 * @param {string} name
 * @returns {string}
 */
function normalizeColor(color, fallback, name) {
  if (color === undefined || color === null) return fallback
  if (typeof color !== 'string' || color.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  return color
}

/**
 * Escape a string for use inside an XML attribute value.
 * @param {string} value
 * @returns {string}
 */
function escapeXmlAttribute(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })
}

/**
 * Drop characters that are not allowed in XML 1.0 attribute values.
 * QR payloads may contain arbitrary Unicode, including control characters.
 * @param {string} value
 * @returns {string}
 */
function sanitizeXmlText(value) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
}

/**
 * Decompose the matrix into disjoint axis-aligned dark rectangles.
 *
 * Classic row-major greedy meshing: each rectangle starts at the first
 * uncovered dark module, extends right along maximal dark runs, then extends
 * down while the whole span stays dark and uncovered. This is still built from
 * horizontal module runs, but merges them vertically, which roughly halves the
 * SVG path size compared with one rectangle per run.
 *
 * @param {boolean[][]} modules
 * @param {number} size
 * @returns {{x: number, y: number, w: number, h: number}[]}
 */
function buildRectangles(modules, size) {
  const used = new Uint8Array(size * size)
  const rectangles = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x] || used[y * size + x]) continue
      let width = 1
      while (x + width < size && modules[y][x + width] && !used[y * size + x + width]) width++
      let height = 1
      grow: while (y + height < size) {
        for (let k = 0; k < width; k++) {
          if (!modules[y + height][x + k] || used[(y + height) * size + x + k]) break grow
        }
        height++
      }
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) used[(y + dy) * size + x + dx] = 1
      }
      rectangles.push({ x, y, w: width, h: height })
    }
  }
  return rectangles
}

/**
 * Serialise rectangles as compact SVG path data.
 *
 * Each rectangle becomes an open sub-path: `M x y h w v h H x` (or relative
 * `m dx dy` after the first). The fill's implicit close provides the left edge,
 * so no `z`/`h -w` is needed. Rectangles are emitted in drawing order, so the
 * relative move starts from the previous rectangle's bottom-left corner.
 *
 * @param {{x: number, y: number, w: number, h: number}[]} rectangles
 * @param {number} margin quiet-zone offset in modules
 * @returns {string}
 */
function rectanglesToPathData(rectangles, margin) {
  let path = ''
  let currentX = 0
  let currentY = 0
  for (let i = 0; i < rectangles.length; i++) {
    const { x, y, w, h } = rectangles[i]
    const left = x + margin
    const top = y + margin
    if (i === 0) {
      path += `M${left} ${top}`
    } else {
      path += `m${left - currentX} ${top - currentY}`
    }
    path += `h${w}v${h}H${left}`
    currentX = left
    currentY = top + h
  }
  return path
}

/**
 * Rotate a square module matrix by 90, 180 or 270 degrees.
 *
 * Only rotations are used for the SVG (never a transpose): QR symbols are
 * rotation-invariant but not mirror-invariant, so a transposed/mirrored matrix
 * would not scan. Row-major rectangle decomposition can be slightly more
 * compact in one of the four orientations, so the renderer emits the shortest.
 *
 * @param {boolean[][]} modules
 * @param {number} size
 * @param {0|1|2|3} quarters number of clockwise quarter turns
 * @returns {boolean[][]}
 */
function rotateModules(modules, size, quarters) {
  if (quarters === 0) return modules
  const result = Array.from({ length: size }, () => new Array(size))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (quarters === 1) result[y][x] = modules[size - 1 - x][y]
      else if (quarters === 2) result[y][x] = modules[size - 1 - y][size - 1 - x]
      else result[y][x] = modules[x][size - 1 - y]
    }
  }
  return result
}

/**
 * Build the compact path data for a module matrix, picking the shortest output
 * across the four valid symbol orientations.
 * @param {boolean[][]} modules
 * @param {number} size
 * @param {number} margin
 * @returns {string}
 */
function buildPathData(modules, size, margin) {
  let best = ''
  for (let quarters = 0; quarters < 4; quarters++) {
    const candidate = rectanglesToPathData(
      buildRectangles(rotateModules(modules, size, quarters), size),
      margin,
    )
    if (best === '' || candidate.length < best.length) best = candidate
  }
  return best
}

/**
 * Render a QR code as a self-contained SVG string.
 *
 * The SVG is one `<svg>` element containing a light background `<rect>` and a
 * single `<path>` whose `d` is built from horizontal run-length rectangles.
 * No scripts, no external references, no embedded fonts: the markup can be
 * injected with `dangerouslySetInnerHTML` inside the plugin panel.
 *
 * @param {string} text payload to encode
 * @param {{ ec?: 'L'|'M'|'Q'|'H', dark?: string, light?: string,
 *   margin?: number, scale?: number, label?: string }} [options]
 *   `ec` error correction level (default {@link QR_DEFAULT_EC}); `dark`/`light`
 *   CSS colours; `margin` quiet-zone width in modules (default 2); `scale`
 *   optional pixel size multiplier (viewBox stays in module units); `label`
 *   accessible name (`aria-label`, defaults to the payload).
 * @returns {string} SVG markup
 * @throws {TypeError} when `text` is not a non-empty string or exceeds capacity
 * @throws {RangeError} when an option is out of range
 */
export function renderQrSvg(text, options = {}) {
  const opts = readOptions(options)
  const margin = normalizeMargin(opts.margin)
  const scale = normalizeScale(opts.scale)
  const dark = normalizeColor(opts.dark, '#000000', 'dark')
  const light = normalizeColor(opts.light, '#ffffff', 'light')
  if (opts.label !== undefined && opts.label !== null && typeof opts.label !== 'string') {
    throw new TypeError('label must be a string')
  }
  const label = sanitizeXmlText(opts.label === undefined || opts.label === null ? text : opts.label)

  const { size, modules } = encodeQr(text, { ec: opts.ec })
  const modulesPerSide = size + margin * 2
  const width = scale === undefined ? modulesPerSide : modulesPerSide * scale
  const pathData = buildPathData(modules, size, margin)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modulesPerSide} ${modulesPerSide}"` +
    ` width="${width}" height="${width}" role="img" shape-rendering="crispEdges"` +
    ` aria-label="${escapeXmlAttribute(label)}">` +
    `<rect width="${modulesPerSide}" height="${modulesPerSide}" fill="${escapeXmlAttribute(light)}"/>` +
    `<path fill="${escapeXmlAttribute(dark)}" d="${pathData}"/>` +
    `</svg>`
  )
}

/**
 * Render a QR code as a base64 SVG data URL (handy for `<img src=...>`).
 * @param {string} text payload to encode
 * @param {Parameters<typeof renderQrSvg>[1]} [options] same options as {@link renderQrSvg}
 * @returns {string} `data:image/svg+xml;base64,...`
 */
export function renderQrDataUrl(text, options = {}) {
  const svg = renderQrSvg(text, options)
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
