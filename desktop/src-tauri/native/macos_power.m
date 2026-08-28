#import <Foundation/Foundation.h>
#import <IOKit/ps/IOPowerSources.h>
#import <IOKit/ps/IOPSKeys.h>
#import <stdint.h>

typedef struct {
    int32_t battery_percent;
    int32_t on_battery;
    int32_t low_power_mode;
} PearWallMacPowerStatus;

int32_t pearwall_macos_power_status(PearWallMacPowerStatus *status) {
    if (status == NULL) {
        return 1;
    }

    status->battery_percent = -1;
    status->on_battery = -1;
    status->low_power_mode = NSProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0;

    CFTypeRef blob = IOPSCopyPowerSourcesInfo();
    if (blob == NULL) {
        return 1;
    }
    CFArrayRef sources = IOPSCopyPowerSourcesList(blob);
    if (sources == NULL) {
        CFRelease(blob);
        return 1;
    }

    CFIndex count = CFArrayGetCount(sources);
    for (CFIndex index = 0; index < count; index += 1) {
        CFTypeRef source = CFArrayGetValueAtIndex(sources, index);
        CFDictionaryRef description = IOPSGetPowerSourceDescription(blob, source);
        if (description == NULL) {
            continue;
        }

        CFNumberRef current = CFDictionaryGetValue(description, CFSTR(kIOPSCurrentCapacityKey));
        CFNumberRef maximum = CFDictionaryGetValue(description, CFSTR(kIOPSMaxCapacityKey));
        int current_value = 0;
        int maximum_value = 0;
        if (status->battery_percent < 0
            && current != NULL
            && maximum != NULL
            && CFNumberGetValue(current, kCFNumberIntType, &current_value)
            && CFNumberGetValue(maximum, kCFNumberIntType, &maximum_value)
            && maximum_value > 0) {
            int percent = (int)((double)current_value / (double)maximum_value * 100.0 + 0.5);
            status->battery_percent = percent < 0 ? 0 : (percent > 100 ? 100 : percent);
        }

        CFStringRef power_source_state = CFDictionaryGetValue(
            description,
            CFSTR(kIOPSPowerSourceStateKey)
        );
        if (power_source_state != NULL) {
            if (CFEqual(power_source_state, CFSTR(kIOPSBatteryPowerValue))) {
                status->on_battery = 1;
            } else if (CFEqual(power_source_state, CFSTR(kIOPSACPowerValue))) {
                status->on_battery = 0;
            }
        }
    }

    CFRelease(sources);
    CFRelease(blob);
    return 0;
}
