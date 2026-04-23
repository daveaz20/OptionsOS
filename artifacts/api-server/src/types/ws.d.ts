declare module "ws" {
  import { EventEmitter } from "node:events";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(url: string | URL, protocols?: string | string[]);
    send(data: string | ArrayBufferLike | Buffer): void;
    close(code?: number, reason?: string): void;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code?: number, reason?: Buffer) => void): this;
  }
}
