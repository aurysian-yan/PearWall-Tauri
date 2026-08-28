#import <AppKit/AppKit.h>
#import <stdint.h>

extern void pearwall_show_settings_window(void);

@interface PearWallStatusController : NSObject
@property(nonatomic, strong) NSStatusItem *statusItem;
@end

@implementation PearWallStatusController

- (void)install {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
    NSStatusBarButton *button = self.statusItem.button;
    NSImage *image = [NSImage imageWithSystemSymbolName:@"waveform"
                              accessibilityDescription:@"Pear Wall"];
    image.template = YES;
    image.size = NSMakeSize(18, 18);
    button.image = image;
    button.toolTip = @"Pear Wall 正在后台运行";

    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Pear Wall"];
    NSMenuItem *statusItem = [[NSMenuItem alloc] initWithTitle:@"Pear Wall 正在后台运行"
                                                       action:nil
                                                keyEquivalent:@""];
    statusItem.enabled = NO;
    [menu addItem:statusItem];
    [menu addItem:NSMenuItem.separatorItem];

    NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"打开 Pear Wall"
                                                     action:@selector(openPearWall:)
                                              keyEquivalent:@""];
    openItem.target = self;
    [menu addItem:openItem];
    [menu addItem:NSMenuItem.separatorItem];

    NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出 Pear Wall"
                                                     action:@selector(quitPearWall:)
                                              keyEquivalent:@"q"];
    quitItem.target = self;
    [menu addItem:quitItem];
    self.statusItem.menu = menu;
    self.statusItem.visible = YES;
}

- (void)openPearWall:(id)sender {
    (void)sender;
    pearwall_show_settings_window();
}

- (void)quitPearWall:(id)sender {
    (void)sender;
    [NSApplication.sharedApplication terminate:nil];
}

@end

int32_t pearwall_main_install_status_item(void) {
    @autoreleasepool {
        static PearWallStatusController *controller = nil;
        if (controller != nil) {
            return 0;
        }
        controller = [[PearWallStatusController alloc] init];
        [controller install];
        return controller.statusItem == nil ? 1 : 0;
    }
}

int32_t pearwall_main_application_is_active(void) {
    return NSApplication.sharedApplication.active ? 1 : 0;
}
