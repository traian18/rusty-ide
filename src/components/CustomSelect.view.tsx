import React, { RefObject } from "react";
import { createPortal } from "react-dom";
import { Option, OptionGroup } from "./CustomSelect";
import styles from "./CustomSelect.module.css";

interface CustomSelectViewProps {
  id: string;
  value: string;
  placeholder: string;
  className: string;
  buttonClassName: string;
  dropdownClassName: string;
  chevronClassName?: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  pos: { top: number; left: number; minWidth: number; openUp: boolean } | null;
  containerRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  selectedOption: Option | undefined;
  showSearch: boolean;
  hasResults: boolean;
  filteredGroups: OptionGroup[] | null;
  filteredOptions: Option[];
  onChange: (val: string) => void;
}

export const CustomSelectView: React.FC<CustomSelectViewProps> = ({
  id,
  value,
  placeholder,
  className,
  buttonClassName,
  dropdownClassName,
  chevronClassName,
  icon,
  isOpen,
  setIsOpen,
  searchQuery,
  setSearchQuery,
  pos,
  containerRef,
  buttonRef,
  dropdownRef,
  selectedOption,
  showSearch,
  hasResults,
  filteredGroups,
  filteredOptions,
  onChange,
}) => {
  const listboxId = `${id}-options`;

  const renderOption = (opt: Option) => {
    const isSelected = opt.id === value;
    return (
      <div
        key={opt.id}
        role="option"
        aria-selected={isSelected}
        onClick={() => {
          onChange(opt.id);
          setIsOpen(false);
        }}
        className={`${styles.option} ${isSelected ? styles.selected : ""}`}
        title={opt.name}
      >
        {opt.name}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`${styles.root} ${className}`}>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClassName || styles.button}
        title={selectedOption ? selectedOption.name : placeholder}
      >
        {icon}
        <span className={styles.label}>{selectedOption ? selectedOption.name : placeholder}</span>
        <svg
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""} ${chevronClassName || ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && pos && createPortal(
        <div
          id={listboxId}
          ref={dropdownRef}
          role="listbox"
          data-custom-select-dropdown
          style={{
            position: "fixed",
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? Math.max(0, window.innerHeight - pos.top) : undefined,
            left: pos.left,
            minWidth: pos.minWidth,
          }}
          className={`${styles.dropdown} ${dropdownClassName}`}
        >
          {showSearch && (
            <div className={styles.searchWrap}>
              <input
                id={`${id}-search`}
                type="text"
                aria-label="Search options"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.search}
              />
            </div>
          )}
          <div className={styles.options}>
            {hasResults ? (
              filteredGroups ? (
                filteredGroups.map((g) => (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>
                      {g.label}
                    </div>
                    <div className={styles.groupOptions}>
                      {g.options.map(renderOption)}
                    </div>
                  </div>
                ))
              ) : (
                filteredOptions.map(renderOption)
              )
            ) : (
              <div className={styles.empty}>
                No options found
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
