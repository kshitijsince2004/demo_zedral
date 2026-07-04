declare module 'puppeteer' {
  interface PdfOptions {
    format?: string;
    printBackground?: boolean;
    margin?: {
      top?: string;
      bottom?: string;
      left?: string;
      right?: string;
    };
  }

  interface Page {
    setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
    pdf(options?: PdfOptions): Promise<Uint8Array>;
  }

  interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  const puppeteer: {
    launch(options?: { headless?: boolean; args?: string[] }): Promise<Browser>;
  };

  export default puppeteer;
}
