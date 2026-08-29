import { QrGallery } from '@/components/qr-gallery'

/**
 * The QR gallery.
 *
 * Deliberately outside the SessionGate: this is the page you reach *before* having a session, and
 * scanning one of the codes on it is how you get one.
 */
export default function Page() {
  return <QrGallery />
}
