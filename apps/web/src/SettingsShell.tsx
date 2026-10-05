import React from "react";
export const settingsSections = [
  { id: "integrations", label: "Integrations" },
  { id: "repository", label: "Repository" },
  { id: "intelligence", label: "Intelligence & autonomy" },
  { id: "access", label: "Agent access" },
  { id: "operations", label: "Background operations" },
] as const;
export type SettingsSection = (typeof settingsSections)[number]["id"];
export function settingsRoute(
  hash: string,
): { section: SettingsSection; integrationId: string | null } | null {
  const integration = hash.match(
    /^#settings\/integrations\/([a-z][a-z0-9-]*)$/,
  )?.[1];
  if (integration)
    return { section: "integrations", integrationId: integration };
  const section = hash.match(/^#settings(?:\/([a-z]+))?$/);
  if (!section) return null;
  return {
    section:
      settingsSections.find((item) => item.id === section[1])?.id ??
      "integrations",
    integrationId: null,
  };
}
export default function SettingsShell({
  section,
  navigate,
  children,
}: {
  section: SettingsSection;
  navigate: (section: SettingsSection) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-shell">
      <nav className="settings-navigation" aria-label="Settings sections">
        {settingsSections.map((item) => (
          <button
            key={item.id}
            className={item.id === section ? "active" : ""}
            aria-current={item.id === section ? "page" : undefined}
            onClick={() => navigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}
