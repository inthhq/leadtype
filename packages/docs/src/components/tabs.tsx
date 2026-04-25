"use client";

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";

type TabsContextValue = {
  items: string[];
  activeValue: string;
  setActiveValue: (value: string) => void;
  groupId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("<Tab> must be used inside <Tabs>");
  }
  return ctx;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Build a stable id for a tab given its index. We include the index so two
 * items that normalize to the same string (e.g. "Tab 1" and "tab 1") still
 * get distinct ids.
 */
function triggerId(groupId: string, normalized: string, index: number): string {
  return `${groupId}-trigger-${normalized}-${index}`;
}

function panelId(groupId: string, normalized: string, index: number): string {
  return `${groupId}-panel-${normalized}-${index}`;
}

export type TabsProps = {
  items?: string[];
  defaultIndex?: number;
  /**
   * Stable id used to derive trigger/panel DOM ids. Useful for SSR-stable
   * markup. Must be unique per page — duplicate `groupId`s will produce
   * duplicate `aria-controls`/`id` attributes. This does NOT sync state
   * across multiple `<Tabs>` instances.
   */
  groupId?: string;
  children?: ReactNode;
};

export function Tabs({
  items = [],
  defaultIndex = 0,
  groupId: providedGroupId,
  children,
}: TabsProps) {
  const initial = items[defaultIndex] ?? items[0] ?? "";
  const [activeValue, setActiveValue] = useState(normalize(initial));
  const generatedGroupId = useId();
  const groupId = providedGroupId ?? generatedGroupId;

  const value = useMemo<TabsContextValue>(
    () => ({ items, activeValue, setActiveValue, groupId }),
    [items, activeValue, groupId]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex(
      (item) => normalize(item) === activeValue
    );
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextItem = items[nextIndex];
    if (nextItem === undefined) {
      return;
    }
    const nextNormalized = normalize(nextItem);
    setActiveValue(nextNormalized);
    // Move focus to the newly active trigger.
    const nextId = triggerId(groupId, nextNormalized, nextIndex);
    document.getElementById(nextId)?.focus();
  };

  return (
    <div data-inth-tabs="">
      {items.length > 0 ? (
        <div data-inth-tabs-list="" role="tablist">
          {items.map((item, index) => {
            const normalized = normalize(item);
            const isActive = normalized === activeValue;
            return (
              <button
                aria-controls={panelId(groupId, normalized, index)}
                aria-selected={isActive}
                data-active={isActive || undefined}
                data-inth-tabs-trigger=""
                id={triggerId(groupId, normalized, index)}
                key={triggerId(groupId, normalized, index)}
                onClick={() => setActiveValue(normalized)}
                onKeyDown={handleKeyDown}
                role="tab"
                // Roving tabindex — only the active trigger is in the tab order.
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                {item}
              </button>
            );
          })}
        </div>
      ) : null}
      <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
    </div>
  );
}

export type TabProps = {
  value: string;
  children?: ReactNode;
};

export function Tab({ value, children }: TabProps) {
  const { items, activeValue, groupId } = useTabsContext();
  const normalized = normalize(value);
  // Match the trigger's index so aria-controls/id stay aligned.
  const index = items.findIndex((item) => normalize(item) === normalized);
  const resolvedIndex = index >= 0 ? index : 0;
  const isActive = normalized === activeValue;

  // Keep the panel in the DOM so the trigger's aria-controls never points at
  // nothing — just hide it from AT and layout when inactive.
  return (
    <div
      aria-labelledby={triggerId(groupId, normalized, resolvedIndex)}
      data-inth-tab-panel=""
      data-value={normalized}
      hidden={!isActive}
      id={panelId(groupId, normalized, resolvedIndex)}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
