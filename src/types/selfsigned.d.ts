// selfsigned ships JavaScript only; minimal surface used by the app.
declare module "selfsigned" {
  interface SelfsignedPems {
    private: string;
    public: string;
    cert: string;
  }
  interface SelfsignedOptions {
    keySize?: number;
    days?: number;
    algorithm?: "sha1" | "sha256";
    extensions?: unknown[];
    attrs?: unknown;
    pkcs7?: boolean;
    clientCertificate?: boolean;
  }
  type GenerateAttrs = { name: string; value: string }[];
  // v5 API: without a callback the call returns a promise; with one it fires
  // the callback. The app always awaits the promise form.
  export function generate(attrs: GenerateAttrs, opts?: SelfsignedOptions): Promise<SelfsignedPems>;
  export function generate(
    attrs: GenerateAttrs,
    opts: SelfsignedOptions | undefined,
    callback: (err: Error | null, pems: SelfsignedPems) => void
  ): void;
}
