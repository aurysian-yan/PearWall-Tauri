#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ColorSync/ColorSync.h>
#import <dispatch/dispatch.h>
#import <dlfcn.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>
#import <unistd.h>

typedef void (^PearWallNowPlayingCallback)(NSDictionary *);
typedef void (*PearWallGetNowPlayingInfo)(dispatch_queue_t, PearWallNowPlayingCallback);
typedef void (^PearWallNowPlayingClientCallback)(id);
typedef void (*PearWallGetNowPlayingClient)(dispatch_queue_t, PearWallNowPlayingClientCallback);
typedef void (*PearWallRegisterForNowPlayingNotifications)(dispatch_queue_t);
typedef NSString *(*PearWallGetClientBundleIdentifier)(id);

static PearWallGetNowPlayingInfo pearwallGetNowPlayingInfo;
static PearWallGetNowPlayingClient pearwallGetNowPlayingClient;
static PearWallGetClientBundleIdentifier pearwallGetClientBundleIdentifier;
static PearWallGetClientBundleIdentifier pearwallGetParentAppBundleIdentifier;

static NSString *PearWallStringValue(id value) {
    if ([value isKindOfClass:NSString.class]) {
        return value;
    }
    if ([value respondsToSelector:@selector(stringValue)]) {
        return [value stringValue];
    }
    return @"";
}

static NSNumber *PearWallNumberValue(id value, double fallback) {
    if ([value isKindOfClass:NSNumber.class]) {
        return value;
    }
    return @(fallback);
}

static NSString *PearWallArtworkMIMEType(NSData *data, NSString *reported) {
    NSString *normalized = reported.lowercaseString;
    if ([normalized hasPrefix:@"image/"]) {
        return normalized;
    }
    const unsigned char *bytes = data.bytes;
    NSUInteger count = data.length;
    if (count >= 8 && memcmp(bytes, "\x89PNG\r\n\x1a\n", 8) == 0) {
        return @"image/png";
    }
    if (count >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) {
        return @"image/jpeg";
    }
    if (count >= 6 && (memcmp(bytes, "GIF87a", 6) == 0 || memcmp(bytes, "GIF89a", 6) == 0)) {
        return @"image/gif";
    }
    if (count >= 12 && memcmp(bytes, "RIFF", 4) == 0 && memcmp(bytes + 8, "WEBP", 4) == 0) {
        return @"image/webp";
    }
    return @"application/octet-stream";
}

static void PearWallLoadMediaRemote(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        void *handle = dlopen(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
            RTLD_LAZY
        );
        if (handle == NULL) {
            return;
        }
        pearwallGetNowPlayingInfo = (PearWallGetNowPlayingInfo)dlsym(
            handle,
            "MRMediaRemoteGetNowPlayingInfo"
        );
        pearwallGetNowPlayingClient = (PearWallGetNowPlayingClient)dlsym(
            handle,
            "MRMediaRemoteGetNowPlayingClient"
        );
        pearwallGetClientBundleIdentifier = (PearWallGetClientBundleIdentifier)dlsym(
            handle,
            "MRNowPlayingClientGetBundleIdentifier"
        );
        pearwallGetParentAppBundleIdentifier = (PearWallGetClientBundleIdentifier)dlsym(
            handle,
            "MRNowPlayingClientGetParentAppBundleIdentifier"
        );
        PearWallRegisterForNowPlayingNotifications registerForNotifications =
            (PearWallRegisterForNowPlayingNotifications)dlsym(
                handle,
                "MRMediaRemoteRegisterForNowPlayingNotifications"
            );
        if (registerForNotifications != NULL) {
            registerForNotifications(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
            usleep(150000);
        }
    });
}

static NSString *PearWallNowPlayingSourceBundleIdentifier(void) {
    if (pearwallGetNowPlayingClient == NULL) {
        return @"";
    }
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block NSString *bundleIdentifier = @"";
    pearwallGetNowPlayingClient(
        dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
        ^(id client) {
            if (client == nil) {
                dispatch_semaphore_signal(semaphore);
                return;
            }
            NSString *parentIdentifier = pearwallGetParentAppBundleIdentifier == NULL
                ? nil
                : pearwallGetParentAppBundleIdentifier(client);
            NSString *clientIdentifier = pearwallGetClientBundleIdentifier == NULL
                ? nil
                : pearwallGetClientBundleIdentifier(client);
            bundleIdentifier = [PearWallStringValue(parentIdentifier.length > 0
                ? parentIdentifier
                : clientIdentifier) copy];
            dispatch_semaphore_signal(semaphore);
        }
    );
    if (dispatch_semaphore_wait(
            semaphore,
            dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)
        ) != 0) {
        return @"";
    }
    return bundleIdentifier;
}

static NSDictionary *PearWallMediaArtwork(
    NSDictionary *info,
    NSString *sourceBundleIdentifier
) {
    if (![info isKindOfClass:NSDictionary.class]) {
        return @{
            @"key": @"",
            @"data_url": NSNull.null,
            @"playing": @NO,
            @"identifier": @"",
            @"source_bundle_id": @"",
            @"raw_title": @"",
            @"raw_artist": @"",
            @"track_id": @0,
            @"title": @"",
            @"artist": @"",
            @"album": @"",
            @"duration": @0,
            @"elapsed": @0,
            @"playback_rate": @0
        };
    }
    NSString *title = PearWallStringValue(info[@"kMRMediaRemoteNowPlayingInfoTitle"]);
    NSString *artist = PearWallStringValue(info[@"kMRMediaRemoteNowPlayingInfoArtist"]);
    NSString *album = PearWallStringValue(info[@"kMRMediaRemoteNowPlayingInfoAlbum"]);
    NSString *identifier = PearWallStringValue(
        info[@"kMRMediaRemoteNowPlayingInfoUniqueIdentifier"]
    );
    NSData *artwork = [info[@"kMRMediaRemoteNowPlayingInfoArtworkData"] isKindOfClass:NSData.class]
        ? info[@"kMRMediaRemoteNowPlayingInfoArtworkData"]
        : nil;
    NSNumber *playbackRate = [info[@"kMRMediaRemoteNowPlayingInfoPlaybackRate"]
        isKindOfClass:NSNumber.class]
        ? info[@"kMRMediaRemoteNowPlayingInfoPlaybackRate"]
        : nil;
    NSNumber *duration = PearWallNumberValue(
        info[@"kMRMediaRemoteNowPlayingInfoDuration"],
        0
    );
    NSNumber *elapsedValue = PearWallNumberValue(
        info[@"kMRMediaRemoteNowPlayingInfoElapsedTime"],
        0
    );
    double elapsed = elapsedValue.doubleValue;
    id timestamp = info[@"kMRMediaRemoteNowPlayingInfoTimestamp"];
    if ([timestamp isKindOfClass:NSDate.class] && playbackRate.doubleValue > 0) {
        elapsed += MAX(0, -[(NSDate *)timestamp timeIntervalSinceNow])
            * playbackRate.doubleValue;
    }
    NSString *key = identifier.length > 0
        ? [NSString stringWithFormat:@"%@|%lu", identifier, (unsigned long)artwork.hash]
        : [NSString stringWithFormat:
            @"%@|%@|%@|%lu",
            title,
            artist,
            album,
            (unsigned long)artwork.hash
        ];
    id dataURL = NSNull.null;
    if (artwork.length > 0) {
        NSString *mimeType = PearWallArtworkMIMEType(
            artwork,
            PearWallStringValue(info[@"kMRMediaRemoteNowPlayingInfoArtworkMIMEType"])
        );
        dataURL = [NSString stringWithFormat:
            @"data:%@;base64,%@",
            mimeType,
            [artwork base64EncodedStringWithOptions:0]
        ];
    }
    BOOL playing = playbackRate == nil ? info.count > 0 : playbackRate.doubleValue > 0;
    return @{
        @"key": key,
        @"data_url": dataURL,
        @"playing": @(playing),
        @"identifier": identifier,
        @"source_bundle_id": sourceBundleIdentifier ?: @"",
        @"raw_title": title,
        @"raw_artist": artist,
        @"track_id": @0,
        @"title": title,
        @"artist": artist,
        @"album": album,
        @"duration": duration,
        @"elapsed": @(MAX(0, elapsed)),
        @"playback_rate": playbackRate ?: @(playing ? 1 : 0)
    };
}

char *pearwall_copy_now_playing_json(void) {
    @autoreleasepool {
        PearWallLoadMediaRemote();
        if (pearwallGetNowPlayingInfo == NULL) {
            return NULL;
        }
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSDictionary *nowPlayingInfo;
        pearwallGetNowPlayingInfo(
            dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
            ^(NSDictionary *info) {
                nowPlayingInfo = [info copy];
                dispatch_semaphore_signal(semaphore);
            }
        );
        if (dispatch_semaphore_wait(
                semaphore,
                dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC)
            ) != 0) {
            return NULL;
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:PearWallMediaArtwork(
                                                           nowPlayingInfo,
                                                           PearWallNowPlayingSourceBundleIdentifier()
                                                       )
                                                       options:0
                                                         error:nil];
        if (json.length == 0) {
            return NULL;
        }
        char *result = malloc(json.length + 1);
        if (result == NULL) {
            return NULL;
        }
        memcpy(result, json.bytes, json.length);
        result[json.length] = '\0';
        return result;
    }
}

void pearwall_free_c_string(char *value) {
    free(value);
}

void pearwall_print_now_playing_json(void) {
    char *json = pearwall_copy_now_playing_json();
    if (json == NULL) {
        fputs("null\n", stdout);
        fflush(stdout);
        return;
    }
    fputs(json, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    pearwall_free_c_string(json);
}

char *pearwall_copy_display_uuid(uint32_t displayID) {
    @autoreleasepool {
        CFUUIDRef uuid = CGDisplayCreateUUIDFromDisplayID(displayID);
        if (uuid == NULL) {
            return NULL;
        }
        NSString *value = CFBridgingRelease(CFUUIDCreateString(NULL, uuid));
        CFRelease(uuid);
        if (value.length == 0) {
            return NULL;
        }
        return strdup(value.UTF8String);
    }
}
