#import <AppKit/AppKit.h>
#import <stdint.h>

static NSString *const PearWallMainAppIdentifier = @"com.nevoit.pearwall.desktop";

@interface PearWallAgentStatusController : NSObject
@property(nonatomic, strong) NSStatusItem *statusItem;
@end

@implementation PearWallAgentStatusController

- (void)install {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
    NSStatusBarButton *button = self.statusItem.button;
    NSImage *image = nil;
    NSURL *imageURL = [NSBundle.mainBundle URLForResource:@"PearWallStatusTemplate"
                                            withExtension:@"svg"];
    if (imageURL != nil) {
        image = [[NSImage alloc] initWithContentsOfURL:imageURL];
    }
    if (image == nil) {
        image = [NSImage imageWithSystemSymbolName:@"waveform"
                         accessibilityDescription:@"Pear Wall"];
    }
    image.template = YES;
    image.size = NSMakeSize(18, 18);
    button.image = image;
    button.toolTip = @"Pear Wall 后台运行";

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
    self.statusItem.menu = menu;
    self.statusItem.visible = YES;
}

- (void)openPearWall:(id)sender {
    NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
    NSURL *appURL = [self parentAppURL];
    if (appURL == nil) {
        appURL = [workspace URLForApplicationWithBundleIdentifier:PearWallMainAppIdentifier];
    }
    if (appURL == nil) {
        NSBeep();
        return;
    }
    NSWorkspaceOpenConfiguration *configuration = NSWorkspaceOpenConfiguration.configuration;
    configuration.activates = YES;
    configuration.allowsRunningApplicationSubstitution = NO;
    [workspace openApplicationAtURL:appURL
                      configuration:configuration
                  completionHandler:nil];
}

- (NSURL *)parentAppURL {
    NSURL *candidate = NSBundle.mainBundle.bundleURL;
    for (NSInteger index = 0; index < 4; index += 1) {
        candidate = candidate.URLByDeletingLastPathComponent;
    }
    NSBundle *bundle = [NSBundle bundleWithURL:candidate];
    if ([bundle.bundleIdentifier isEqualToString:PearWallMainAppIdentifier]) {
        return candidate;
    }
    return nil;
}

@end

int32_t pearwall_agent_run_status_item(void) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        static PearWallAgentStatusController *controller = nil;
        controller = [[PearWallAgentStatusController alloc] init];
        [controller install];
        [application run];
        return 0;
    }
}
