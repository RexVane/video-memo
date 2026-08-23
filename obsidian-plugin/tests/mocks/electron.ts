/**
 * Mock of the electron module used by source-modal.ts, which calls
 * `require("electron")` to resolve a picked file's real path via
 * `webUtils.getPathForFile`. Tests attach a fake path to the File object.
 */

export interface ElectronMockFile extends File {
  __mockPath?: string;
}

export const webUtils = {
  getPathForFile: (file: ElectronMockFile): string => file.__mockPath ?? "",
};

export const __mock = { webUtils };
