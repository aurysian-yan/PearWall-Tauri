#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>

static NSString *const PearWallAgentIdentifier = @"com.nevoit.pearwall.agent";

NSInteger pearwall_agent_service_status(void) {
    if (@available(macOS 13.0, *)) {
        return [SMAppService loginItemServiceWithIdentifier:PearWallAgentIdentifier].status;
    }
    return SMAppServiceStatusNotFound;
}

char *pearwall_agent_service_set_enabled(int32_t enabled) {
    if (@available(macOS 13.0, *)) {
        SMAppService *service = [SMAppService loginItemServiceWithIdentifier:PearWallAgentIdentifier];
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
        return strdup(message == NULL ? "后台运行时操作失败" : message);
    }
    return strdup("当前 macOS 版本不支持后台运行时");
}

void pearwall_agent_service_free_error(char *error) {
    free(error);
}
