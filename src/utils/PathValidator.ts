import { existsSync } from 'fs';
import path from 'path';
import ErrorHelper from './ErrorHelper.js';
import type { McpResult } from '../types/index.js';

export class PathValidator {
  /**
   * Resolve relative paths to absolute paths and validate project path
   */
  public static resolveAndValidateProjectPath(projectPath: string, parameterName: string = 'xcodeproj'): { resolvedPath: string; error: McpResult | null } {
    if (!projectPath) {
      const guidance = [
        `• Specify the path to your .xcodeproj or .xcworkspace file using the "${parameterName}" parameter`,
        "• Example: /Users/username/MyApp/MyApp.xcodeproj (absolute path)",
        "• Example: MyApp.xcodeproj (relative to current directory)",
        "• You can drag the project file from Finder to get the path"
      ].join('\n');
      return { 
        resolvedPath: projectPath,
        error: { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Missing required parameter: ${parameterName}`, guidance) }] }
      };
    }
    
    // Resolve relative paths to absolute paths
    const resolvedPath = path.isAbsolute(projectPath) ? projectPath : path.resolve(process.cwd(), projectPath);
    
    // Validate the resolved absolute path
    const validationError = this.validateProjectPath(resolvedPath, parameterName);
    
    return {
      resolvedPath,
      error: validationError
    };
  }

  public static validateProjectPath(projectPath: string, parameterName: string = 'xcodeproj'): McpResult | null {
    if (!projectPath) {
      const guidance = [
        `• Specify the absolute path to your .xcodeproj or .xcworkspace file using the "${parameterName}" parameter`,
        "• Example: /Users/username/MyApp/MyApp.xcodeproj",
        "• You can drag the project file from Finder to get the path"
      ].join('\n');
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Missing required parameter: ${parameterName}`, guidance) }] };
    }
    
    if (!path.isAbsolute(projectPath)) {
      const guidance = [
        "• Use an absolute path starting with /",
        "• Example: /Users/username/MyApp/MyApp.xcodeproj",
        "• Avoid relative paths like ./MyApp.xcodeproj"
      ].join('\n');
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Project path must be absolute, got: ${projectPath}`, guidance) }] };
    }
    
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Project file does not exist: ${projectPath}`, ErrorHelper.getProjectNotFoundGuidance(projectPath)) }] };
    }
    
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        const guidance = [
          "• The project file appears to be corrupted or incomplete",
          "• Try recreating the project in Xcode",
          "• Check if you have the correct permissions to access the file",
          "• Make sure the project wasn't partially copied"
        ].join('\n');
        return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Project is missing project.pbxproj file: ${pbxprojPath}`, guidance) }] };
      }
    }
    
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        const guidance = [
          "• The workspace file appears to be corrupted or incomplete",
          "• Try recreating the workspace in Xcode",
          "• Check if you have the correct permissions to access the file",
          "• Make sure the workspace wasn't partially copied"
        ].join('\n');
        return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}`, guidance) }] };
      }
    }

    return null;
  }

  public static validateFilePath(filePath: string): McpResult | null {
    if (!path.isAbsolute(filePath)) {
      const guidance = [
        "• Use an absolute path starting with /",
        "• Example: /Users/username/MyApp/ViewController.swift",
        "• You can drag the file from Xcode navigator to get the path"
      ].join('\n');
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`File path must be absolute, got: ${filePath}`, guidance) }] };
    }
    
    if (!existsSync(filePath)) {
      const guidance = [
        `• Check that the file path is correct: ${filePath}`,
        "• Make sure the file hasn't been moved or deleted",
        "• Verify you have permission to access the file",
        "• Try refreshing the project navigator in Xcode"
      ].join('\n');
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`File does not exist: ${filePath}`, guidance) }] };
    }

    return null;
  }
}

export default PathValidator;
