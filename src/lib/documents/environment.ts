// Runtime shims that the PDF parser needs. Imported once for its side effects, before any parse runs.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// Ensure Promise.withResolvers is available (standard in ES2024, polyfilled for older WebKit / Safari)
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers === "undefined") {
  (Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Ensure ReadableStream supports async iteration (for-await-of) across all WebKit / Safari engines
if (typeof ReadableStream !== "undefined" && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// Ensure PDF.js worker is registered in all environments (browser/Tauri webview and Node)
// so it never fails with 'No "GlobalWorkerOptions.workerSrc" specified.'
if (typeof globalThis !== "undefined") {
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
}
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";
}
