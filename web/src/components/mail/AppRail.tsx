import { CalendarDays, HardDrive, KeyRound, Users, Wallet } from "lucide-react";

const APPS = [
  {
    name: "Calendar",
    icon: CalendarDays,
    className: "bg-[#f59e42] text-white",
  },
  {
    name: "Contacts",
    icon: Users,
    className: "bg-[#7b5cff] text-white",
  },
  {
    name: "Drive",
    icon: HardDrive,
    className: "bg-[#3e8dff] text-white",
  },
  {
    name: "Pass",
    icon: KeyRound,
    className: "bg-[#8b5cf6] text-white",
  },
  {
    name: "Wallet",
    icon: Wallet,
    className: "bg-[#de4d8c] text-white",
  },
];

export function AppRail() {
  return (
    <aside className="app-rail pt-[72px]" aria-label="Other apps" aria-hidden="true">
      {APPS.map((app) => {
        const Icon = app.icon;
        return (
          <span
            key={app.name}
            title={app.name}
            className={`flex h-7 w-7 items-center justify-center rounded-lg ${app.className}`}
          >
            <Icon className="h-[15px] w-[15px]" />
          </span>
        );
      })}
    </aside>
  );
}
