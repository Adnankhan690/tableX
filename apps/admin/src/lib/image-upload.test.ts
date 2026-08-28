import { describe, expect, it } from 'bun:test'
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_TYPES,
  acceptedContentType,
  fitWithin,
  MAX_DIMENSION,
  needsReencoding,
} from './image-upload'

/**
 * The decisions made before a photograph is uploaded. Everything here is pure -- the canvas
 * work in prepareImage needs a DOM and is covered by the Playwright pass -- and each of
 * these is a rule the server enforces too, so a disagreement between the two shows up as a
 * manager waiting through an upload that was always going to be refused.
 */

describe('acceptedContentType', () => {
  it('accepts the three formats the server stores', () => {
    for (const type of ACCEPTED_TYPES) {
      expect(acceptedContentType({ type })).toBe(type)
    }
  })

  it('normalises the case and parameters a real file picker produces', () => {
    // Browsers genuinely send these forms on a File's `type`.
    expect(acceptedContentType({ type: 'IMAGE/JPEG' })).toBe('image/jpeg')
    expect(acceptedContentType({ type: 'image/jpeg; charset=binary' })).toBe('image/jpeg')
    expect(acceptedContentType({ type: '  image/png  ' })).toBe('image/png')
  })

  it('refuses SVG, which is the one that matters', () => {
    // An SVG executes script in whichever browser renders it, and these objects are served
    // from a host of ours. The server refuses it too; this just refuses it sooner.
    expect(acceptedContentType({ type: 'image/svg+xml' })).toBeNull()
  })

  it('refuses other files a picker will happily hand over', () => {
    for (const type of [
      'image/gif',
      'image/heic',
      'image/tiff',
      'application/pdf',
      'text/html',
      'video/mp4',
      'application/octet-stream',
    ]) {
      expect(acceptedContentType({ type })).toBeNull()
    }
  })

  it('refuses an empty type rather than guessing', () => {
    // Some Android pickers hand over a File with no type at all. Guessing would spend the
    // restaurant's uplink on an upload the server then rejects.
    expect(acceptedContentType({ type: '' })).toBeNull()
    expect(acceptedContentType({ type: '   ' })).toBeNull()
  })

  it('drives the file input accept attribute from the same list', () => {
    for (const type of ACCEPTED_TYPES) {
      expect(ACCEPT_ATTRIBUTE).toContain(type)
    }
    expect(ACCEPT_ATTRIBUTE).not.toContain('svg')
  })
})

describe('fitWithin', () => {
  it('leaves an image that already fits untouched', () => {
    // Upscaling would add bytes and no detail.
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales the longest edge down and preserves the aspect ratio', () => {
    // A typical phone photograph, landscape and portrait.
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('handles a square', () => {
    expect(fitWithin(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('never rounds an extreme aspect ratio down to zero', () => {
    // A panorama of a menu board. A canvas of zero width throws, so the short edge floors
    // at 1 rather than rounding away.
    const result = fitWithin(20000, 5, 1600)
    expect(result.width).toBe(1600)
    expect(result.height).toBeGreaterThanOrEqual(1)
  })

  it('tolerates a zero dimension instead of dividing by it', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 })
  })
})

describe('needsReencoding', () => {
  const maxBytes = 5 * 1024 * 1024

  it('leaves a small, correctly sized photo alone', () => {
    // The case worth protecting: re-encoding this would lose quality for nothing and would
    // flatten a PNG's transparency for no reason.
    expect(needsReencoding(200_000, 1200, 900, maxBytes)).toBe(false)
  })

  it('re-encodes anything over the byte ceiling', () => {
    expect(needsReencoding(maxBytes + 1, 800, 600, maxBytes)).toBe(true)
  })

  it('re-encodes anything over the pixel ceiling even when the file is small', () => {
    // A large but efficiently compressed image still costs a diner on 3G to download and
    // still gets scaled down in the browser, so the extra pixels buy nothing.
    expect(needsReencoding(120_000, MAX_DIMENSION + 1, 900, maxBytes)).toBe(true)
    expect(needsReencoding(120_000, 900, MAX_DIMENSION + 1, maxBytes)).toBe(true)
  })

  it('treats the ceilings themselves as acceptable', () => {
    // Off-by-one here would needlessly re-encode a file that was already exactly right.
    expect(needsReencoding(maxBytes, MAX_DIMENSION, MAX_DIMENSION, maxBytes)).toBe(false)
  })

  it('follows the server ceiling rather than a hard-coded one', () => {
    // max_bytes is configuration and arrives on the upload response, so a deployment that
    // lowers it must tighten this check too.
    expect(needsReencoding(300_000, 800, 600, 256_000)).toBe(true)
  })
})
