declare module 'puppeteer' {
  const puppeteer: {
    launch(options?: Record<string, unknown>): Promise<{
      newPage(): Promise<{
        setContent(html: string, options?: Record<string, unknown>): Promise<void>;
        pdf(options?: Record<string, unknown>): Promise<Uint8Array>;
      }>;
      close(): Promise<void>;
    }>;
  };
  export default puppeteer;
}
