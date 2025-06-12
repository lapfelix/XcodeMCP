import { existsSync } from 'fs';
import path from 'path';

export class PathValidator {
  static validateProjectPath(projectPath) {
    if (!projectPath) {
      return { content: [{ type: 'text', text: 'Project path is required. Please specify the path to your .xcodeproj or .xcworkspace file.' }] };
    }
    
    if (!path.isAbsolute(projectPath)) {
      return { content: [{ type: 'text', text: `Project path must be absolute, got: ${projectPath}\nExample: /Users/username/path/to/project.xcodeproj` }] };
    }
    
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: `Project file does not exist: ${projectPath}` }] };
    }
    
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        return { content: [{ type: 'text', text: `Project is missing project.pbxproj file: ${pbxprojPath}` }] };
      }
    }
    
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        return { content: [{ type: 'text', text: `Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}` }] };
      }
    }

    return null;
  }

  static validateFilePath(filePath) {
    if (!path.isAbsolute(filePath)) {
      return { content: [{ type: 'text', text: `File path must be absolute, got: ${filePath}\nExample: /Users/username/path/to/file.swift` }] };
    }
    
    if (!existsSync(filePath)) {
      return { content: [{ type: 'text', text: `File does not exist: ${filePath}` }] };
    }

    return null;
  }
}