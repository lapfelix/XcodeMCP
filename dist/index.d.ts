#!/usr/bin/env node
import { XcodeServer } from './XcodeServer.js';
export declare class XcodeMCPServer extends XcodeServer {
    constructor(options?: {
        includeClean?: boolean;
        preferredScheme?: string;
        preferredXcodeproj?: string;
    });
    start(port?: number): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map