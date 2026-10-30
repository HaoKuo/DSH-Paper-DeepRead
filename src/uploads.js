/**
 * PDF upload inbox: filename hygiene, request-body streaming with a hard size
 * limit, `%PDF-` magic sniffing, and one-file storage under `uploads/`.
 *
 * @module dsh-paper-deepread/uploads
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { StoreError, newUploadId } from './store.js'

/** Maximum name length kept from a browser-provided filename. */
const MAX_NAME_BYTES = 180

/** PDF magic bytes every accepted upload must start with. */
export const PDF_MAGIC = Buffer.from('%PDF-', 'ascii')

/**
 * Sanitize a browser/curl filename into a display name and safe file stem.
 * Control characters, path separators, and leading dots are removed; the name
 * is limited in length and must end in `.pdf` once the extension is added.
 *
 * @param {unknown} raw Filename header value.
 * @returns {{name: string, stem: string}}
 * @throws {StoreError} `BAD_FILENAME` for missing/unsafe names.
 */
export function sanitizeFilename(raw) {
  if (typeof raw !== 'string') throw new StoreError('BAD_FILENAME', 'x-filename header is required')
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    throw new StoreError('BAD_FILENAME', 'x-filename header is not valid percent-encoding')
  }
  value = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
  // Browser filenames never include a path, but curl users may; keep the base.
  value = value.split(/[\\/]/u).pop() ?? ''
  value = value.replace(/^\.+/u, '').trim()
  if (!value) throw new StoreError('BAD_FILENAME', 'filename is empty after sanitizing')
  if (!/\.pdf$/iu.test(value)) value = `${value.replace(/\.+$/u, '')}.pdf`
  const stem = value.replace(/\.pdf$/iu, '').replace(/[^\p{L}\p{N}._ ()-]+/gu, '_').slice(0, MAX_NAME_BYTES).trim() || 'paper'
  return { name: `${stem}.pdf`, stem }
}

/**
 * Read a raw HTTP request body into memory, rejecting oversized payloads.
 *
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {number} maxBytes Hard limit.
 * @returns {Promise<Buffer>} Body bytes.
 * @throws {StoreError} `PAYLOAD_TOO_LARGE` or `BAD_BODY`.
 */
export async function readRequestBody(req, maxBytes) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new StoreError('PAYLOAD_TOO_LARGE', `request body exceeds ${maxBytes} bytes`)
  }
  const chunks = []
  let total = 0
  try {
    for await (const chunk of req) {
      total += chunk.length
      if (total > maxBytes) throw new StoreError('PAYLOAD_TOO_LARGE', `request body exceeds ${maxBytes} bytes`)
      chunks.push(Buffer.from(chunk))
    }
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError('BAD_BODY', `could not read request body: ${String(error?.message || error)}`)
  }
  return Buffer.concat(chunks, total)
}

/**
 * Validate a body as a PDF.
 * @param {Buffer} body Candidate bytes.
 * @returns {void}
 * @throws {StoreError} `UNSUPPORTED_MEDIA_TYPE` when the magic is missing.
 */
export function assertPdfBody(body) {
  if (!Buffer.isBuffer(body) || body.length < PDF_MAGIC.length || !body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new StoreError('UNSUPPORTED_MEDIA_TYPE', 'uploaded file is not a PDF (missing %PDF- signature)')
  }
}

/**
 * Persist one uploaded PDF under `uploads/<id>.pdf`.
 *
 * @param {import('./store.js').PaperStore} store Managed store.
 * @param {{name: string, bytes: Buffer}} upload Sanitized name and bytes.
 * @returns {{id: string, name: string, bytes: number, pdfRelative: string, pdfPath: string}}
 */
export function writeUploadFile(store, upload) {
  const id = newUploadId()
  mkdirSync(store.uploadsDir, { recursive: true })
  const fileName = `${id}.pdf`
  const relative = `uploads/${fileName}`
  const target = join(store.uploadsDir, fileName)
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    // Synchronous write keeps the request path simple; uploads are capped at
    // 80 MB and are written once before the record enters the state file.
    writeFileSync(tmp, upload.bytes)
    renameSync(tmp, target)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  return { id, name: upload.name, bytes: upload.bytes.length, pdfRelative: relative, pdfPath: target }
}

/** Directory for one upload's ingest work. */
export function uploadWorkDir(store, id) {
  return join(store.workDir, id)
}

/** Remove a temporary upload file after a failed request. */
export function removeFileQuietly(path) {
  try {
    if (path) rmSync(path, { force: true })
  } catch { /* ignore */ }
}

/** Parent directory helper used by tests. */
export function parentOf(path) {
  return dirname(path)
}
