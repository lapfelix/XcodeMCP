export class ErrorHelper {
  public static createErrorWithGuidance(message: string, guidance: string): string {
    return `${message}\n\n💡 To fix this:\n${guidance}`;
  }

  public static getXcodeNotFoundGuidance(): string {
    return [
      "• Install Xcode from the Mac App Store",
      "• Make sure Xcode is in your /Applications folder",
      "• Launch Xcode once to complete the installation",
      "• Accept the license agreement when prompted"
    ].join('\n');
  }

  public static getProjectNotFoundGuidance(projectPath: string): string {
    return [
      `• Check that the path is correct: ${projectPath}`,
      "• Use an absolute path (starting with /)",
      "• Make sure the file extension is .xcodeproj or .xcworkspace",
      "• Verify the project file hasn't been moved or deleted"
    ].join('\n');
  }

  public static getSchemeNotFoundGuidance(schemeName: string, availableSchemes: string[] = []): string {
    const guidance = [
      `• Check the scheme name spelling: '${schemeName}'`,
      "• Scheme names are case-sensitive"
    ];
    
    if (availableSchemes.length > 0) {
      guidance.push("• Available schemes:");
      availableSchemes.forEach(scheme => {
        guidance.push(`  - ${scheme}`);
      });
    } else {
      guidance.push("• Run 'Get Schemes' to see available schemes");
    }
    
    return guidance.join('\n');
  }

  public static getDestinationNotFoundGuidance(destination: string, availableDestinations: string[] = []): string {
    const guidance = [
      `• Check the destination name spelling: '${destination}'`,
      "• Destination names are case-sensitive"
    ];
    
    if (availableDestinations.length > 0) {
      guidance.push("• Available destinations:");
      availableDestinations.forEach(dest => {
        guidance.push(`  - ${dest}`);
      });
    } else {
      guidance.push("• Run 'Get Run Destinations' to see available destinations");
    }
    
    return guidance.join('\n');
  }

  public static getXcodeNotRunningGuidance(): string {
    return [
      "• Launch Xcode application",
      "• Make sure Xcode is not stuck on a license agreement",
      "• Try restarting Xcode if it's already open",
      "• Check Activity Monitor for any hanging Xcode processes"
    ].join('\n');
  }

  public static getNoWorkspaceGuidance(): string {
    return [
      "• Open a project in Xcode first",
      "• Make sure the project has finished loading",
      "• Try closing and reopening the project if it's already open",
      "• Check that the project file is not corrupted"
    ].join('\n');
  }

  public static getBuildLogNotFoundGuidance(): string {
    return [
      "• Try building the project again",
      "• Check that Xcode has permission to write to derived data",
      "• Clear derived data (Product → Clean Build Folder) and rebuild",
      "• Ensure XCLogParser is installed: brew install xclogparser"
    ].join('\n');
  }

  public static getJXAPermissionGuidance(): string {
    return [
      "• Go to System Preferences → Privacy & Security → Automation",
      "• Allow your terminal app to control Xcode",
      "• You may need to restart your terminal after granting permission",
      "• If using VS Code, allow 'Code' to control Xcode"
    ].join('\n');
  }

  public static parseCommonErrors(error: Error | { message?: string }): string | null {
    const errorMessage = error.message || error.toString();
    
    if (errorMessage.includes('Xcode got an error: Application isn\'t running')) {
      return this.createErrorWithGuidance(
        "Xcode is not running",
        this.getXcodeNotRunningGuidance()
      );
    }
    
    if (errorMessage.includes('No active workspace')) {
      return this.createErrorWithGuidance(
        "No active workspace found in Xcode",
        this.getNoWorkspaceGuidance()
      );
    }
    
    if (errorMessage.includes('not allowed assistive access')) {
      return this.createErrorWithGuidance(
        "Permission denied - automation access required",
        this.getJXAPermissionGuidance()
      );
    }
    
    if (errorMessage.includes('osascript: command not found')) {
      return this.createErrorWithGuidance(
        "macOS scripting tools not available",
        "• This MCP server requires macOS\n• Make sure you're running on a Mac with osascript available"
      );
    }
    
    return null;
  }
}

export default ErrorHelper;
