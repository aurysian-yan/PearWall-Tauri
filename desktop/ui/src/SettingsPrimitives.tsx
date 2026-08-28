import { Card, Switch } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { PauseIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type IconType = typeof PauseIcon;

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 px-4 text-[14px] font-semibold text-white/90">
      {children}
    </h2>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SmoothCorners
      asChild
      autoEffects={false}
      corners={{ radius: 24, smoothing: 0.6 }}
      innerBorder={{ width: 1, color: "#ffffff", opacity: 0.1 }}
    >
      <Card
        variant="transparent"
        className={`gap-0 overflow-hidden bg-black/25 p-0 text-white shadow-none backdrop-blur-[10px] backdrop-saturate-150 ${className ?? ""}`}
      >
        {children}
      </Card>
    </SmoothCorners>
  );
}

export function DrawerCard({ children }: { children: ReactNode }) {
  return (
    <SmoothCorners
      asChild
      autoEffects={false}
      corners={{ radius: 18, smoothing: 0.6 }}
    >
      <div className="overflow-hidden bg-white/8">{children}</div>
    </SmoothCorners>
  );
}

export function SettingRow({
  icon: Icon,
  avatar,
  title,
  badge,
  description,
  children,
  className,
}: {
  icon?: IconType;
  avatar?: string;
  title: string;
  badge?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-18 items-center gap-3 px-4 py-3 ${className ?? ""}`}
    >
      {avatar ? (
        <img
          src={avatar}
          alt=""
          className="h-5 w-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        Icon && (
          <Icon
            aria-hidden
            size={20}
            weight="regular"
            className="shrink-0 text-white/90"
          />
        )
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold leading-tight text-white">
          <span>{title}</span>
          {badge && (
            <SmoothCorners
              asChild
              autoEffects={false}
              corners={{ radius: 10, smoothing: 1 }}
            >
              <span className="shrink-0 bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                {badge}
              </span>
            </SmoothCorners>
          )}
        </div>
        {description && (
          <div className="mt-1 text-xs leading-snug text-white/65">
            {description}
          </div>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      aria-label={label}
      isSelected={value}
      onChange={onChange}
      isDisabled={disabled}
      size="lg"
    >
      <Switch.Content>
        <Switch.Control className="data-[selected=true]:bg-green-500">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
