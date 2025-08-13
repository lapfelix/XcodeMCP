export declare class ErrorHelper {
    static createErrorWithGuidance(message: string, guidance: string): string;
    static getXcodeNotFoundGuidance(): string;
    static getProjectNotFoundGuidance(projectPath: string): string;
    static getSchemeNotFoundGuidance(schemeName: string, availableSchemes?: string[]): string;
    static getDestinationNotFoundGuidance(destination: string, availableDestinations?: string[]): string;
    static getXcodeNotRunningGuidance(): string;
    static getNoWorkspaceGuidance(): string;
    static getBuildLogNotFoundGuidance(): string;
    static getJXAPermissionGuidance(): string;
    static parseCommonErrors(error: Error | {
        message?: string;
    }): string | null;
}
//# sourceMappingURL=ErrorHelper.d.ts.map