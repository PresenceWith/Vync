// tools/electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("vyncDesktop", {
  isDesktopApp: true
});
