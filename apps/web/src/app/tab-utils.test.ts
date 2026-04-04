import { describe, it, expect } from 'vitest';
import { computeLabels } from './tab-utils';

describe('computeLabels', () => {
  it('returns empty array for empty input', () => {
    expect(computeLabels([])).toEqual([]);
  });

  it('returns basename for a single file', () => {
    const result = computeLabels(['/home/user/project/plan.vync']);
    expect(result).toEqual([
      { filePath: '/home/user/project/plan.vync', label: 'plan.vync' },
    ]);
  });

  it('returns basename when all basenames are unique', () => {
    const result = computeLabels(['/a/foo.vync', '/b/bar.vync']);
    expect(result).toEqual([
      { filePath: '/a/foo.vync', label: 'foo.vync' },
      { filePath: '/b/bar.vync', label: 'bar.vync' },
    ]);
  });

  it('uses parent/basename for duplicate basenames', () => {
    const result = computeLabels([
      '/projects/alpha/plan.vync',
      '/projects/beta/plan.vync',
    ]);
    expect(result).toEqual([
      { filePath: '/projects/alpha/plan.vync', label: 'alpha/plan.vync' },
      { filePath: '/projects/beta/plan.vync', label: 'beta/plan.vync' },
    ]);
  });

  it('handles filename-only paths (no directory)', () => {
    const result = computeLabels(['plan.vync']);
    expect(result).toEqual([{ filePath: 'plan.vync', label: 'plan.vync' }]);
  });

  it('disambiguates only duplicates, leaves uniques as basename', () => {
    const result = computeLabels([
      '/a/plan.vync',
      '/b/plan.vync',
      '/c/notes.vync',
    ]);
    expect(result).toEqual([
      { filePath: '/a/plan.vync', label: 'a/plan.vync' },
      { filePath: '/b/plan.vync', label: 'b/plan.vync' },
      { filePath: '/c/notes.vync', label: 'notes.vync' },
    ]);
  });
});
