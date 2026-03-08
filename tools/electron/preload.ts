import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('vyncDesktop', {
  isDesktopApp: true,
});
