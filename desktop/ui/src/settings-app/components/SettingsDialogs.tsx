import { Button, Modal } from "@heroui/react";
import { SmoothCorners } from "@lisse/react";
import { MonitorIcon, SpeakerHighIcon } from "@phosphor-icons/react";

export function PermissionNotice({
  open,
  onOpenChange,
  onAcknowledge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
}) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop
        variant="blur"
        isDismissable={false}
        isKeyboardDismissDisabled
        className="dark"
      >
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <SpeakerHighIcon aria-hidden size={22} weight="regular" />
              </Modal.Icon>
              <Modal.Heading>音频可视化需要系统权限</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>
                为了让画面跟随当前播放的声音律动，macOS 要求 Pear Wall
                获得系统音频录制权限。该权限由 macOS
                归类在“屏幕与系统音频录制”中，但 Pear Wall
                不会读取屏幕画面，也不会保存音频内容。
              </p>
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <SpeakerHighIcon
                    aria-hidden
                    size={20}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                  <div>
                    <p className="font-medium text-foreground">音频可视化</p>
                    <p>让主界面和纯享模式根据系统声音实时律动。</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <MonitorIcon
                    aria-hidden
                    size={20}
                    className="mt-0.5 shrink-0 text-foreground"
                  />
                  <div>
                    <p className="font-medium text-foreground">
                      屏幕保护程序与动态壁纸
                    </p>
                    <p>由 Pear Wall 在后台持续提供声音节奏数据。</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-surface-secondary p-4">
                <p className="font-medium text-surface-secondary-foreground">
                  授予权限后需要彻底重启
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5">
                  <li>
                    在“系统设置 &gt; 隐私与安全性 &gt; 屏幕与系统音频录制”中允许
                    Pear Wall。
                  </li>
                  <li>若 macOS 显示“退出并重新打开”，请选择该操作。</li>
                  <li>
                    如果没有出现提示，从菜单栏的 Pear Wall 图标中选择“退出 Pear
                    Wall”，然后重新打开。
                  </li>
                </ol>
                <p className="mt-3 text-xs">只关闭窗口不算完全退出。</p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={onAcknowledge}>我知道了</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function ResetSettingsDialog({
  open,
  onOpenChange,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
        <Modal.Backdrop variant="blur" className="!bg-backdrop/35">
          <Modal.Container size="sm" placement="center" className="!p-0">
            <div className="my-auto">
              <SmoothCorners
                asChild
                autoEffects={false}
                corners={{ radius: 37, smoothing: 0.6 }}
                innerBorder={{
                  width: 1,
                  color: "currentColor",
                  opacity: 0.1,
                }}
              >
                <Modal.Dialog className="!w-[299px] !max-w-[299px] !overflow-hidden !bg-background/30 !p-0 !text-overlay-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
                  <Modal.Header className="!gap-0 !px-[25px] !pt-[23px] !text-left">
                    <Modal.Heading className="!text-[15px] !font-bold !leading-[18px] !text-overlay-foreground">
                      恢复默认设置？
                    </Modal.Heading>
                  </Modal.Header>
                  <Modal.Body className="!-m-0 !mt-3 !px-[25px] !pb-0 !text-[14px] !font-normal !leading-5.5 !text-muted">
                    <p>这会将主页中的所有设置恢复为默认值，且无法撤销。</p>
                  </Modal.Body>
                  <Modal.Footer className="!mt-[18px] !flex-col !items-stretch !gap-[7px] !px-[18px] !pb-[18px]">
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 18, smoothing: 1 }}
                    >
                      <Button
                        variant="danger-soft"
                        size="sm"
                        fullWidth
                        onPress={onReset}
                        className="!h-8 !min-h-8 !px-0 !text-[15px] !font-normal !leading-[18px]"
                      >
                        恢复默认
                      </Button>
                    </SmoothCorners>
                    <SmoothCorners
                      asChild
                      autoEffects={false}
                      corners={{ radius: 18, smoothing: 1 }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onPress={() => onOpenChange(false)}
                        className="!h-8 !min-h-8 !bg-foreground/10 !px-0 !text-[15px] !font-normal !leading-[18px] hover:!bg-foreground/15"
                      >
                        取消
                      </Button>
                    </SmoothCorners>
                  </Modal.Footer>
                </Modal.Dialog>
              </SmoothCorners>
            </div>
          </Modal.Container>
        </Modal.Backdrop>
    </Modal>
  );
}
