// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TabBar } from './tab-bar';
import type { TabInfo } from './tab-utils';

afterEach(cleanup);

function renderTabBar(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
  const props = {
    tabs: [] as TabInfo[],
    activeFilePath: null as string | null,
    registeredFiles: [] as string[],
    discoveredFiles: [] as string[],
    onTabClick: vi.fn(),
    onTabClose: vi.fn(),
    onAddFile: vi.fn(),
    onDiscoverFile: vi.fn(),
    onDropdownOpen: vi.fn(),
    ...overrides,
  };
  return { ...render(<TabBar {...props} />), props };
}

describe('TabBar', () => {
  it('renders tabs from props', () => {
    const tabs: TabInfo[] = [
      { filePath: '/a/plan.vync', label: 'plan.vync' },
      { filePath: '/b/notes.vync', label: 'notes.vync' },
    ];
    renderTabBar({ tabs });
    expect(screen.getByText('plan.vync')).toBeTruthy();
    expect(screen.getByText('notes.vync')).toBeTruthy();
  });

  it('marks active tab with active class', () => {
    const tabs: TabInfo[] = [
      { filePath: '/a/plan.vync', label: 'plan.vync' },
      { filePath: '/b/notes.vync', label: 'notes.vync' },
    ];
    renderTabBar({ tabs, activeFilePath: '/b/notes.vync' });
    const activeTab = screen.getByText('notes.vync').closest('.vync-tab');
    expect(activeTab?.classList.contains('vync-tab--active')).toBe(true);
    const inactiveTab = screen.getByText('plan.vync').closest('.vync-tab');
    expect(inactiveTab?.classList.contains('vync-tab--active')).toBe(false);
  });

  it('calls onTabClick when tab is clicked', () => {
    const onTabClick = vi.fn();
    const tabs: TabInfo[] = [{ filePath: '/a/plan.vync', label: 'plan.vync' }];
    renderTabBar({ tabs, onTabClick });
    fireEvent.click(screen.getByText('plan.vync'));
    expect(onTabClick).toHaveBeenCalledWith('/a/plan.vync');
  });

  it('calls onTabClose and stops propagation on close button click', () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const tabs: TabInfo[] = [{ filePath: '/a/plan.vync', label: 'plan.vync' }];
    renderTabBar({ tabs, onTabClick, onTabClose });
    fireEvent.click(screen.getByLabelText('Close plan.vync'));
    expect(onTabClose).toHaveBeenCalledWith('/a/plan.vync');
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it('toggles dropdown on + button click', () => {
    const onDropdownOpen = vi.fn();
    renderTabBar({
      registeredFiles: ['/a/plan.vync'],
      discoveredFiles: [],
      onDropdownOpen,
    });
    const addBtn = screen.getByLabelText('Open file');
    expect(addBtn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(addBtn);
    expect(addBtn.getAttribute('aria-expanded')).toBe('true');
    expect(onDropdownOpen).toHaveBeenCalled();

    fireEvent.click(addBtn);
    expect(addBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows reopenable files in dropdown', () => {
    const tabs: TabInfo[] = [{ filePath: '/a/plan.vync', label: 'plan.vync' }];
    renderTabBar({
      tabs,
      registeredFiles: ['/a/plan.vync', '/b/notes.vync'],
      discoveredFiles: [],
    });
    fireEvent.click(screen.getByLabelText('Open file'));
    expect(screen.getByText('Reopen')).toBeTruthy();
    expect(screen.getByText('notes.vync')).toBeTruthy();
  });

  it('shows discovered files in dropdown', () => {
    renderTabBar({
      discoveredFiles: ['/c/ideas.vync'],
    });
    fireEvent.click(screen.getByLabelText('Open file'));
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('ideas.vync')).toBeTruthy();
  });

  it('shows empty state when no files available', () => {
    renderTabBar({
      registeredFiles: [],
      discoveredFiles: [],
    });
    fireEvent.click(screen.getByLabelText('Open file'));
    expect(screen.getByText(/No files found/)).toBeTruthy();
  });
});
