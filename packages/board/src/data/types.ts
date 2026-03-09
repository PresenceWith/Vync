import { PlaitElement, PlaitTheme, Viewport } from '@plait/core';

export interface VyncExportedData {
  type: VyncExportedType.vync;
  version: number;
  source: 'web';
  elements: PlaitElement[];
  viewport: Viewport;
  theme?: PlaitTheme;
}

export enum VyncExportedType {
    vync = 'vync'
}