// Browser-only: extracts positioned text from a PDF with pdf.js. Loaded on demand so CSV users never download it.
import { getDocument, GlobalWorkerOptions, PasswordResponses } from "pdfjs-dist";
import type { PdfTextItem } from "@/lib/pdf-table";

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) { super("password"); }
}

export async function readPdfText(file: File, password?: string): Promise<PdfTextItem[]> {
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), password });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") throw new PdfPasswordError((error as Error & { code?: number }).code === PasswordResponses.INCORRECT_PASSWORD);
    throw error;
  }
  try {
    const items: PdfTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [, , c, d, x, y] = item.transform as number[];
        items.push({ text: item.str, x, y, width: item.width, height: item.height || Math.hypot(c, d), page: pageNumber });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await task.destroy();
  }
}
