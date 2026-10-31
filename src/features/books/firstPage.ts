/** Wide enough for the largest cover on a dense screen. */
const WIDTH = 480;
const JPEG_QUALITY = 0.85;

/** Draws the first page of a PDF, as a JPEG. */
export async function drawFirstPage(file: ArrayBuffer): Promise<ArrayBuffer> {
  // Heavy, and only ever needed once for each PDF: loaded on the first one.
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({
    data: new Uint8Array(file),
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const scale = WIDTH / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // "print" draws at once; on screen it waits for frames a hidden window
    // never gets, and a book can be added with the app behind another.
    await page.render({ canvas, viewport, intent: "print" }).promise;
    const image = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (image === null) {
      throw new Error("The page could not be drawn");
    }
    return await image.arrayBuffer();
  } finally {
    await task.destroy();
  }
}
