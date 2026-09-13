import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Paintbrush,
  Maximize2,
  History,
  Heart,
  Images,
  Menu,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { Button } from "../ui/Controls";

export const workspaceTabs = [
  { id: "create", label: "Создать", icon: Plus, group: "Инструменты" },
  {
    id: "thumbnail",
    label: "Обложка",
    icon: Paintbrush,
    group: "Инструменты",
  },
  { id: "image-tools", label: "Размер и качество", icon: Maximize2, group: "Инструменты" },
  { id: "history", label: "История", icon: History, group: "Хранилище" },
  { id: "favorites", label: "Избранное", icon: Heart, group: "Хранилище" },
  { id: "references", label: "Референсы", icon: Images, group: "Хранилище" },
] as const;

export type AppTab = (typeof workspaceTabs)[number]["id"];

export function WorkspaceNavigation({
  activeTab,
  onSelect,
  theme,
  onToggleTheme,
  hidden = false,
}: {
  activeTab: AppTab;
  onSelect: (tab: AppTab) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  hidden?: boolean;
}) {
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1280px)").matches,
  );
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onChange = () => {
      setOpen(false);
      setWide(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!dialog.current) return;
    if (open && !hidden && !wide) {
      dialog.current.showModal();
      dialog.current
        .querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus();
    } else if (dialog.current.open) dialog.current.close();
  }, [open, hidden, wide]);

  const select = (tab: AppTab) => {
    onSelect(tab);
    if (!wide) {
      focusHeading.current = true;
      setOpen(false);
    }
  };

  const navigation = (
    <>
      <button
        className="studio-brand"
        onClick={() => select("create")}
        aria-label="Cover — создать обложку"
      >
        <span className="studio-brand-symbol" aria-hidden="true">
          <span />
          <span />
        </span>
        <span>Cover</span>
      </button>
      <nav className="studio-navigation" aria-label="Разделы Cover">
        <div
          role="tablist"
          aria-label="Рабочие разделы"
          aria-orientation="vertical"
          onKeyDown={(event) => {
            const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
            if (!keys.includes(event.key)) return;
            const container = event.currentTarget as HTMLDivElement;
            const tabs = Array.from(
              container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            );
            const index = tabs.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            tabs[next]?.focus();
          }}
        >
          {["Инструменты", "Хранилище"].map((group) => (
            <div
              className="studio-nav-group"
              key={group}
              role="group"
              aria-label={group}
            >
              <p className="studio-nav-label" aria-hidden="true">
                {group}
              </p>
              {workspaceTabs
                .filter((tab) => tab.group === group)
                .map((tab) => (
                  <button
                    type="button"
                    role="tab"
                    key={tab.id}
                    id={`studio-tab-${tab.id}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls="studio-panel"
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    className="studio-nav-item"
                    onClick={() => select(tab.id)}
                  >
                    <tab.icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="studio-nav-footer">
        <Button
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={
            theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"
          }
        >
          {theme === "light" ? (
            <Moon size={18} aria-hidden="true" />
          ) : (
            <Sun size={18} aria-hidden="true" />
          )}
          {theme === "light" ? "Светлая тема" : "Тёмная тема"}
        </Button>
      </div>
    </>
  );

  if (hidden) return null;
  if (wide) return <aside className="studio-sidebar">{navigation}</aside>;
  return (
    <>
      <div className="studio-mobile-bar">
        <Button
          ref={trigger}
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Menu size={20} aria-hidden="true" />
        </Button>
        <span>Cover</span>
        <Button
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={
            theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"
          }
        >
          {theme === "light" ? (
            <Moon size={18} aria-hidden="true" />
          ) : (
            <Sun size={18} aria-hidden="true" />
          )}
        </Button>
      </div>
      <dialog
        ref={dialog}
        className="studio-menu"
        aria-label="Навигация Cover"
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
          if (focusHeading.current) {
            document.getElementById("studio-screen-title")?.focus();
            focusHeading.current = false;
          } else trigger.current?.focus();
        }}
      >
        <div className="studio-menu-content">
          <Button
            variant="ghost"
            className="studio-menu-close"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
          >
            <X size={20} aria-hidden="true" />
          </Button>
          {navigation}
        </div>
      </dialog>
    </>
  );
}
