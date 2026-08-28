import type { ImageContentType } from '@tablex/shared'

/**
 * Preparing and uploading a dish photograph (docs/DECISIONS.md D15).
 *
 * The browser PUTs the file straight to Cloudflare R2 on a presigned URL, so none of this
 * passes through the API. What lives here is everything that has to happen on the client
 * first: refusing a file the server would refuse anyway, and shrinking a phone photograph
 * to something a diner on 3G can afford to download.
 */

/**
 * What the server accepts. Mirrors `extensionByContentType` in
 * backend/internal/storage/keys.go, and the omission matters: **SVG is not an image here.**
 * It is a script-bearing document, and these objects are served from a host of ours.
 */
export const ACCEPTED_TYPES: readonly ImageContentType[] = ['image/jpeg', 'image/png', 'image/webp']

/** The `accept` attribute for the file input, derived so it cannot drift from the list. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',')

/**
 * The longest edge a stored photograph is allowed to have.
 *
 * 1600px is about twice the widest a dish image is ever rendered at, which leaves headroom
 * for a high-DPI screen and nothing more. A 4032px phone photograph downscaled to this is
 * roughly a twentieth of the bytes, and PRD 7 makes those bytes a product requirement --
 * every one of them is paid for by a diner on a 3G connection, once per menu load.
 */
export const MAX_DIMENSION = 1600

/**
 * A fallback ceiling, used only before the menu has loaded.
 *
 * THE REAL CEILING COMES FROM THE SERVER, as `image_max_upload_bytes` on the admin menu
 * response, and callers pass it to `prepareImage`. That matters on a deployment which has
 * lowered `storage.max_upload_bytes`: assuming this value there produces a dead end, because
 * a 3MB photo is small enough that nothing downscales it, the server refuses it with
 * `TX_IMG_003`, and retrying the same file takes the identical branch and fails identically.
 *
 * Matches the server's own default, so the two agree on an unconfigured deployment.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * JPEG quality when re-encoding.
 *
 * 0.85 is the knee: below it, compression artefacts start showing on food photography,
 * which is the one subject where they are most visible and least forgivable.
 */
const JPEG_QUALITY = 0.85

export type PreparedImage = {
  blob: Blob
  contentType: ImageContentType
  /** True when the file was re-encoded, so the UI can say what happened to it. */
  resized: boolean
}

export type PrepareFailure = { ok: false; error: string }
export type PrepareSuccess = { ok: true; image: PreparedImage }
export type PrepareResult = PrepareSuccess | PrepareFailure

/**
 * Checks a file's declared type against what the server accepts.
 *
 * Pure, and separated from the canvas work below so it can be tested without a DOM. This is
 * a courtesy check only -- the server sniffs the actual bytes at confirm time and does not
 * trust anything decided here.
 */
export function acceptedContentType(file: { type: string }): ImageContentType | null {
  // A File's `type` can carry parameters and arbitrary case, and on some Android pickers it
  // arrives empty. An empty type is refused here rather than guessed: the server would
  // refuse the upload anyway, and guessing wrong wastes the restaurant's uplink first.
  const normalised = file.type.split(';')[0]?.trim().toLowerCase() ?? ''
  return ACCEPTED_TYPES.find((accepted) => accepted === normalised) ?? null
}

/**
 * Scales a width and height down to fit inside a square of `max`, preserving aspect ratio.
 *
 * Returns the input untouched when it already fits -- upscaling a small photograph would
 * add bytes and no detail.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest === 0) return { width, height }

  const scale = max / longest
  // Rounded, and floored at 1: a canvas of zero width throws, and an extreme aspect ratio
  // (a panorama of a menu board, say) can otherwise round the short edge to nothing.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Decides whether a file can be sent as it stands.
 *
 * A file that already fits both limits is uploaded **untouched**, which is the case worth
 * protecting: re-encoding it would lose quality for nothing, and would flatten a PNG's
 * transparency for no reason.
 */
export function needsReencoding(
  sizeBytes: number,
  width: number,
  height: number,
  maxBytes: number,
) {
  return sizeBytes > maxBytes || Math.max(width, height) > MAX_DIMENSION
}

/**
 * Prepares a file for upload: validates it, and downscales it if it is bigger than the
 * server or the diner would like.
 *
 * Needs a DOM (Image, canvas), so it is the one function here that cannot be unit tested;
 * everything it decides with is above and is.
 */
export async function prepareImage(file: File, maxBytes: number): Promise<PrepareResult> {
  const contentType = acceptedContentType(file)
  if (contentType === null) {
    return { ok: false, error: 'Choose a JPEG, PNG or WebP photo.' }
  }
  if (file.size === 0) {
    return { ok: false, error: 'That file is empty.' }
  }

  let bitmap: HTMLImageElement
  try {
    bitmap = await loadImage(file)
  } catch {
    // A file with an image content type that will not decode. Refusing here saves an upload
    // the server would reject at confirm time anyway (TX_IMG_006).
    return { ok: false, error: 'That file could not be read as an image.' }
  }

  const { naturalWidth: width, naturalHeight: height } = bitmap

  if (!needsReencoding(file.size, width, height, maxBytes)) {
    return { ok: true, image: { blob: file, contentType, resized: false } }
  }

  const target = fitWithin(width, height, MAX_DIMENSION)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height

  const context = canvas.getContext('2d')
  if (context === null) {
    return { ok: false, error: 'This browser could not process the photo.' }
  }

  /*
    A WHITE FILL BEFORE THE DRAW, and it is not cosmetic.

    The output below is always JPEG, which has no alpha channel. Drawing a transparent PNG
    onto a fresh canvas and encoding it as JPEG renders every transparent pixel BLACK, so a
    dish shot on a transparent background arrives as a dish on a black rectangle. Filling
    white first makes those pixels white, which is what the person uploading expected.
  */
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, target.width, target.height)
  context.drawImage(bitmap, 0, 0, target.width, target.height)

  /*
    JPEG unconditionally, rather than preserving the source format or trying WebP first.

    WebP would compress better, but `canvas.toBlob` with an unsupported type does not fail --
    it silently falls back to PNG, and the content type we then declare would not match the
    bytes, which the server rejects at confirm time (TX_IMG_006). A deterministic format is
    worth more here than a marginally smaller file.

    Re-encoding a PNG to JPEG is the right trade for the same reason: this path is only
    reached by a file that is already too big, and a downscaled photographic PNG frequently
    still is.
  */
  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
  if (blob === null) {
    return { ok: false, error: 'This browser could not process the photo.' }
  }

  // Downscaling normally takes a 6MB photograph to a few hundred KB, but a pathological
  // input can still land over the ceiling -- and the server would refuse it, so refuse it
  // here where the message can be useful.
  if (blob.size > maxBytes) {
    return { ok: false, error: 'That photo is too large, even after resizing. Try a smaller one.' }
  }

  return { ok: true, image: { blob, contentType: 'image/jpeg', resized: true } }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    // Revoked on both paths: an object URL pins the whole file in memory until it is
    // released, and a manager working through a menu picks a lot of files.
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    image.src = url
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

/**
 * PUTs the prepared file to the presigned URL.
 *
 * XMLHttpRequest rather than fetch, for one reason: **fetch cannot report upload progress.**
 * A restaurant uploading over venue wifi needs to see that something is happening, and a
 * button that sits disabled for forty seconds reads as a hung page.
 *
 * `headers` must be replayed exactly as the server issued them -- they are inside the
 * signature. Host and Content-Length are absent from that map by design; the browser
 * supplies both, and a Content-Length that disagrees with the body is precisely what the
 * signature is there to catch.
 */
export function putToStorage(
  target: { url: string; method: string; headers: Record<string, string> },
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('Upload aborted', 'AbortError')

    /*
      An already-aborted signal is rejected DIRECTLY rather than by calling request.abort().

      `abort()` only fires an abort event when the send flag is set -- that is, once send()
      has been called. Aborting here, before send(), sets the request to DONE and fires
      nothing, so `onabort` below would never run and this promise would never settle. The
      caller would await forever, with the upload button stuck.
    */
    if (signal?.aborted) {
      reject(aborted())
      return
    }

    const request = new XMLHttpRequest()
    request.open(target.method, target.url, true)

    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value)
    }

    if (onProgress) {
      request.upload.onprogress = (event) => {
        // lengthComputable is false on some proxies, in which case a progress bar would
        // jump around meaninglessly. Reporting nothing lets the UI show an indeterminate
        // state instead of a wrong number.
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total)
        }
      }
    }

    // Detached on every terminal outcome, not just on abort. `{ once: true }` only removes
    // it after it FIRES, so an upload that completes normally would otherwise leave a
    // listener on the caller's signal -- and a signal reused across a menu's worth of
    // uploads would accumulate one per dish.
    const onAbort = () => request.abort()
    const settle = (finish: () => void) => {
      signal?.removeEventListener('abort', onAbort)
      finish()
    }

    request.onload = () =>
      settle(() => {
        if (request.status >= 200 && request.status < 300) {
          resolve()
          return
        }
        /*
          R2 answers with an XML error body, which is not worth surfacing to a manager. The
          status is what distinguishes the two cases that actually happen:
            403 -- the presigned URL expired, or the browser altered a signed header
            413 -- the body exceeded what was signed
          Both are "try again", so the message says that rather than guessing.
        */
        reject(new Error(`The upload was rejected (${request.status}). Please try again.`))
      })

    // A CORS failure on the bucket lands here with status 0 and no detail, which is the
    // single most likely first-run problem -- hence naming it.
    request.onerror = () =>
      settle(() =>
        reject(new Error('The upload could not reach the storage service. Check your connection.')),
      )
    request.ontimeout = () =>
      settle(() => reject(new Error('The upload timed out. Please try again.')))
    request.onabort = () => settle(() => reject(aborted()))

    signal?.addEventListener('abort', onAbort, { once: true })

    request.send(blob)
  })
}
