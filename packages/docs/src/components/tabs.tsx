"use client";

import {
  createContext,
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

export type TabsProps = {
  items?: string[];
  defaultIndex?: number;
  children?: ReactNode;
};

export function Tabs({ items = [], defaultIndex = 0, children }: TabsProps) {
  const initial = items[defaultIndex] ?? items[0] ?? "";
  const [activeValue, setActiveValue] = useState(normalize(initial));
  const groupId = useId();

  const value = useMemo<TabsContextValue>(
    () => ({ items, activeValue, setActiveValue }),
    [items, activeValue]
  );

  return (
    <div data-inth-tabs="">
      {items.length > 0 ? (
        <div data-inth-tabs-list="" role="tablist">
          {items.map((item) => {
            const normalized = normalize(item);
            const isActive = normalized === activeValue;
            return (
              <button
                aria-controls={`${groupId}-${normalized}`}
                aria-selected={isActive}
                data-active={isActive || undefined}
                data-inth-tabs-trigger=""
                id={`${groupId}-trigger-${normalized}`}
                key={normalized}
                onClick={() => setActiveValue(normalized)}
                role="tab"
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
  const { activeValue } = useTabsContext();
  const normalized = normalize(value);
  if (normalized !== activeValue) {
    return null;
  }
  return (
    <div data-inth-tab-panel="" data-value={normalized} role="tabpanel">
      {children}
    </div>
  );
}
