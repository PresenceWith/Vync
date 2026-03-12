import { useState, useRef, useEffect } from 'react';
import type { TabInfo } from './tab-utils';
import './tab-bar.scss';

interface TabBarProps {
  tabs: TabInfo[];
  activeFilePath: string | null;
  registeredFiles: string[];
  discoveredFiles: string[];
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onAddFile: (filePath: string) => void;
  onDiscoverFile: (filePath: string) => void;
  onDropdownOpen: () => void;
}

export function TabBar({
  tabs,
  activeFilePath,
  registeredFiles,
  discoveredFiles,
  onTabClick,
  onTabClose,
  onAddFile,
  onDiscoverFile,
  onDropdownOpen,
}: TabBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const unopenedFiles = registeredFiles.filter(
    (f) => !tabs.some((t) => t.filePath === f)
  );

  return (
    <div className="vync-tab-bar">
      <div className="vync-tab-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.filePath}
            className={`vync-tab ${
              activeFilePath === tab.filePath ? 'vync-tab--active' : ''
            }`}
            title={tab.filePath}
            onClick={() => onTabClick(tab.filePath)}
          >
            <span>{tab.label}</span>
            <button
              className="vync-tab__close"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.filePath);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="vync-tab-add" ref={dropdownRef}>
        <span
          onClick={() => {
            const willOpen = !dropdownOpen;
            setDropdownOpen(willOpen);
            if (willOpen) onDropdownOpen();
          }}
        >
          +
        </span>
        {dropdownOpen && (
          <div className="vync-tab-dropdown">
            {unopenedFiles.length > 0 && (
              <>
                <div className="vync-tab-dropdown__section">Reopen</div>
                {unopenedFiles.map((fp) => {
                  const parts = fp.split('/');
                  const label = parts[parts.length - 1] || fp;
                  return (
                    <div
                      key={fp}
                      className="vync-tab-dropdown__item"
                      title={fp}
                      onClick={() => {
                        onAddFile(fp);
                        setDropdownOpen(false);
                      }}
                    >
                      {label}
                    </div>
                  );
                })}
              </>
            )}
            {discoveredFiles.length > 0 && (
              <>
                <div className="vync-tab-dropdown__section">Open</div>
                {discoveredFiles.map((fp) => {
                  const parts = fp.split('/');
                  const label = parts[parts.length - 1] || fp;
                  return (
                    <div
                      key={fp}
                      className="vync-tab-dropdown__item"
                      title={fp}
                      onClick={() => {
                        onDiscoverFile(fp);
                        setDropdownOpen(false);
                      }}
                    >
                      {label}
                    </div>
                  );
                })}
              </>
            )}
            {unopenedFiles.length === 0 && discoveredFiles.length === 0 && (
              <div className="vync-tab-dropdown__empty">
                No files found.
                <br />
                Use <code>vync open &lt;file&gt;</code> to add files.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
