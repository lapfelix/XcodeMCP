import type { McpResult } from '../types/index.js';
export declare class XCResultTools {
    /**
     * Browse xcresult file - list tests or show specific test details
     */
    static xcresultBrowse(xcresultPath: string, testId?: string, includeConsole?: boolean): Promise<McpResult>;
    /**
     * Get console output for a specific test
     */
    static xcresultBrowserGetConsole(xcresultPath: string, testId: string): Promise<McpResult>;
    /**
     * Get a quick summary of an xcresult file
     */
    static xcresultSummary(xcresultPath: string): Promise<McpResult>;
    /**
     * List all attachments for a test
     */
    static xcresultListAttachments(xcresultPath: string, testId: string): Promise<McpResult>;
    /**
     * Export a specific attachment by index
     */
    static xcresultExportAttachment(xcresultPath: string, testId: string, attachmentIndex: number, convertToJson?: boolean): Promise<McpResult>;
    /**
     * Get UI hierarchy attachment from test as JSON (slim AI-readable version by default)
     */
    static xcresultGetUIHierarchy(xcresultPath: string, testId: string, timestamp?: number, fullHierarchy?: boolean, rawFormat?: boolean): Promise<McpResult>;
    /**
     * Get screenshot from failed test - returns direct screenshot or extracts from video
     */
    static xcresultGetScreenshot(xcresultPath: string, testId: string, timestamp: number): Promise<McpResult>;
    /**
     * Find App UI hierarchy attachments (text-based)
     */
    private static findAppUIHierarchyAttachments;
    /**
     * Find UI Snapshot attachments (legacy method)
     */
    /**
     * Find the UI snapshot closest to a given timestamp
     */
    private static findClosestUISnapshot;
    /**
     * Export UI hierarchy attachment and convert to JSON (legacy plist method)
     */
    /**
     * Convert UI hierarchy plist to JSON using plutil -p (readable format)
     */
    private static convertUIHierarchyToJSON;
    /**
     * Parse plutil -p output to extract UI hierarchy information
     */
    private static parsePlutilOutput;
    /**
     * Export text-based UI hierarchy attachment and convert to JSON
     */
    private static exportTextUIHierarchyAsJSON;
    /**
     * Convert indented text-based UI hierarchy to structured JSON
     */
    private static convertIndentedUIHierarchyToJSON;
    /**
     * Parse a single line of UI element information
     */
    private static parseUIElementLine;
    /**
     * Save UI hierarchy data to a JSON file
     */
    private static saveUIHierarchyJSON;
    /**
     * Create slim AI-readable UI hierarchy with index mapping
     */
    private static createSlimUIHierarchy;
    /**
     * Get UI element details by index from previously exported hierarchy
     */
    static xcresultGetUIElement(hierarchyJsonPath: string, elementIndex: number, includeChildren?: boolean): Promise<McpResult>;
    /**
     * Find the closest image attachment to a specific timestamp
     */
    private static findClosestImageAttachment;
    /**
     * Find video attachment by type identifier and filename extension
     */
    private static findVideoAttachment;
    /**
     * Export screenshot attachment to temporary directory
     */
    private static exportScreenshotAttachment;
    /**
     * Extract screenshot from video attachment using ffmpeg at specific timestamp
     */
    private static extractScreenshotFromVideo;
    /**
     * Run ffmpeg to extract a frame from video as PNG at specific timestamp
     */
    private static runFFmpeg;
}
//# sourceMappingURL=XCResultTools.d.ts.map