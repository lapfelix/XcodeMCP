#!/usr/bin/env node
import { XcodeServer } from './XcodeServer.js';
export declare class XcodeMCPServer extends XcodeServer {
    constructor(options?: {
        includeClean?: boolean;
    });
    start(port?: number): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map