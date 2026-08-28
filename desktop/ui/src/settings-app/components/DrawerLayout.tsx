import { Button } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { CaretLeft } from "@phosphor-icons/react";
import { Drawer } from "vaul";
import type { IconType } from "../../SettingsPrimitives";

export function DrawerHeader({
  title,
  progress,
  onBack,
  className,
}: {
  title: string;
  progress: number;
  onBack?: () => void;
  className?: string;
}) {
  const backButton = (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label="返回"
      onPress={onBack}
      className="z-30 !bg-white/8 text-white/75 hover:!bg-white/20 hover:text-white !p-0 backdrop-blur-[10px] backdrop-saturate-150 min-w-9 min-h-9 -m-1"
    >
      <CaretLeft aria-hidden size={24} className="absolute min-w-6 min-h-6" />
    </Button>
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-16 ${className ?? ""}`}
    >
      <div className="relative flex h-16 items-center justify-between px-5 pt-2">
        <div className="pointer-events-auto">
          {onBack ? (
            backButton
          ) : (
            <Drawer.Close asChild>{backButton}</Drawer.Close>
          )}
        </div>
        {onBack ? (
          <h1 className="z-30 pointer-events-none absolute inset-x-20 truncate text-center text-base font-semibold text-white -mt-1">
            {title}
          </h1>
        ) : (
          <span
            aria-hidden
            className="z-30 pointer-events-none absolute inset-x-20 truncate text-center text-base font-semibold text-white transition-opacity duration-200 -mt-1"
            style={{ opacity: progress }}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

export function DrawerHero({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: IconType;
}) {
  return (
    <div className="px-4 pb-5 pt-18">
      <SmoothCorners
        asChild
        autoEffects={false}
        corners={{ radius: 18, smoothing: 0.6 }}
      >
        <div className=" bg-white/8 px-5 pb-6 pt-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white/85">
            <Icon aria-hidden size={24} weight="regular" />
          </div>
          <Drawer.Title className="mt-2 text-[18px] font-semibold text-white">
            {title}
          </Drawer.Title>
          <Drawer.Description className="mt-1 text-[12px] leading-relaxed text-white/65">
            {description}
          </Drawer.Description>
        </div>
      </SmoothCorners>
    </div>
  );
}
