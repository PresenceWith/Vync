export interface TabInfo {
  filePath: string;
  label: string;
}

export function computeLabels(filePaths: string[]): TabInfo[] {
  const basenames = filePaths.map((fp) => {
    const parts = fp.split('/');
    return parts[parts.length - 1] || fp;
  });

  const counts = new Map<string, number>();
  for (const bn of basenames) {
    counts.set(bn, (counts.get(bn) || 0) + 1);
  }

  return filePaths.map((fp, i) => {
    const bn = basenames[i];
    if ((counts.get(bn) ?? 0) > 1) {
      const parts = fp.split('/');
      const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
      return { filePath: fp, label: parent ? `${parent}/${bn}` : bn };
    }
    return { filePath: fp, label: bn };
  });
}
