/* iOS 12：blob: 没有文件名，Safari 会存成 unknown。
   页面把 PDF 交给 SW 后，再打开带文件名的同域地址。须用 ES5。 */
var pendingLegacyPdf = null

self.addEventListener('message', function (event) {
  var data = event.data
  if (!data || data.type !== 'STORE_LEGACY_PDF') return
  pendingLegacyPdf = {
    filename: data.filename,
    buffer: data.buffer,
  }
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({ ok: true })
  }
})

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url)
  if (url.pathname.indexOf('/legacy-pdf/') === -1) return
  if (!pendingLegacyPdf || !pendingLegacyPdf.buffer) return

  var filename = pendingLegacyPdf.filename || 'jianpu.pdf'
  var ascii = String(filename)
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '')
  var encoded = encodeURIComponent(filename)
  event.respondWith(
    new Response(pendingLegacyPdf.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'inline; filename="' + ascii + "\"; filename*=UTF-8''" + encoded,
        'Cache-Control': 'no-store',
      },
    })
  )
})
