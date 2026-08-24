#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>

static NSString *const PearWallLegacyAgentIdentifier = @"com.nevoit.pearwall.agent";

NSInteger pearwall_main_service_status(void) {
    return SMAppService.mainAppService.status;
}

char *pearwall_main_service_set_enabled(int32_t enabled) {
    SMAppService *service = SMAppService.mainAppService;
    if ((enabled && service.status == SMAppServiceStatusEnabled) ||
        (!enabled && service.status == SMAppServiceStatusNotRegistered)) {
        return NULL;
    }
    NSError *error = nil;
    BOOL succeeded = enabled
        ? [service registerAndReturnError:&error]
        : [service unregisterAndReturnError:&error];
    if (succeeded) {
        return NULL;
    }
    const char *message = error.localizedDescription.UTF8String;
    return strdup(message == NULL ? "后台运行操作失败" : message);
}

void pearwall_main_service_free_error(char *error) {
    free(error);
}

void pearwall_legacy_agent_service_remove(void) {
    @autoreleasepool {
        for (NSRunningApplication *application in
             [NSRunningApplication runningApplicationsWithBundleIdentifier:
                 PearWallLegacyAgentIdentifier]) {
            [application terminate];
        }

        SMAppService *service =
            [SMAppService loginItemServiceWithIdentifier:PearWallLegacyAgentIdentifier];
        if (service.status != SMAppServiceStatusNotRegistered &&
            service.status != SMAppServiceStatusNotFound) {
            [service unregisterAndReturnError:nil];
        }
    }
}
