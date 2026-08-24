#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <stdint.h>

typedef void (*PearWallAudioCallback)(const float *samples,
                                      uint32_t frameCount,
                                      double sampleRate,
                                      void *context);

typedef struct {
    AudioObjectID tapID;
    AudioDeviceID aggregateDeviceID;
    AudioDeviceIOProcID ioProcID;
    PearWallAudioCallback callback;
    void *context;
    BOOL running;
} PearWallAudioState;

static PearWallAudioState PearWallState = {
    .tapID = kAudioObjectUnknown,
    .aggregateDeviceID = kAudioObjectUnknown,
    .ioProcID = NULL,
    .callback = NULL,
    .context = NULL,
    .running = NO,
};

static void pearwall_macos_audio_cleanup(void) {
    if (PearWallState.aggregateDeviceID != kAudioObjectUnknown &&
        PearWallState.ioProcID != NULL) {
        AudioDeviceStop(PearWallState.aggregateDeviceID, PearWallState.ioProcID);
        AudioDeviceDestroyIOProcID(PearWallState.aggregateDeviceID,
                                   PearWallState.ioProcID);
    }
    if (PearWallState.aggregateDeviceID != kAudioObjectUnknown) {
        AudioHardwareDestroyAggregateDevice(PearWallState.aggregateDeviceID);
    }
    if (PearWallState.tapID != kAudioObjectUnknown) {
        AudioHardwareDestroyProcessTap(PearWallState.tapID);
    }
    PearWallState.tapID = kAudioObjectUnknown;
    PearWallState.aggregateDeviceID = kAudioObjectUnknown;
    PearWallState.ioProcID = NULL;
    PearWallState.callback = NULL;
    PearWallState.context = NULL;
    PearWallState.running = NO;
}

int32_t pearwall_macos_audio_start(PearWallAudioCallback callback, void *context) {
    @autoreleasepool {
        if (PearWallState.running) {
            return noErr;
        }
        if (callback == NULL || context == NULL) {
            return kAudio_ParamError;
        }

        CATapDescription *tapDescription =
            [[CATapDescription alloc] initMonoGlobalTapButExcludeProcesses:@[]];
        tapDescription.name = @"Pear Wall 系统音频";
        tapDescription.privateTap = YES;
        tapDescription.muteBehavior = CATapUnmuted;

        OSStatus status = AudioHardwareCreateProcessTap(tapDescription,
                                                        &PearWallState.tapID);
        if (status != noErr) {
            pearwall_macos_audio_cleanup();
            return status;
        }

        AudioStreamBasicDescription format = {0};
        UInt32 formatSize = sizeof(format);
        AudioObjectPropertyAddress formatAddress = {
            kAudioTapPropertyFormat,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        };
        status = AudioObjectGetPropertyData(PearWallState.tapID,
                                            &formatAddress,
                                            0,
                                            NULL,
                                            &formatSize,
                                            &format);
        if (status != noErr || format.mFormatID != kAudioFormatLinearPCM ||
            (format.mFormatFlags & kAudioFormatFlagIsFloat) == 0 ||
            format.mBitsPerChannel != 32 || format.mChannelsPerFrame != 1) {
            pearwall_macos_audio_cleanup();
            return status == noErr ? kAudioDeviceUnsupportedFormatError : status;
        }

        NSString *tapUID = tapDescription.UUID.UUIDString;
        NSString *aggregateUID = [NSString stringWithFormat:
            @"com.nevoit.pearwall.audio.%@", NSUUID.UUID.UUIDString];
        NSDictionary *tapConfiguration = @{
            @kAudioSubTapUIDKey: tapUID,
            @kAudioSubTapDriftCompensationKey: @YES,
        };
        NSDictionary *aggregateConfiguration = @{
            @kAudioAggregateDeviceNameKey: @"Pear Wall 系统音频",
            @kAudioAggregateDeviceUIDKey: aggregateUID,
            @kAudioAggregateDeviceIsPrivateKey: @YES,
            @kAudioAggregateDeviceIsStackedKey: @NO,
            @kAudioAggregateDeviceTapAutoStartKey: @YES,
            @kAudioAggregateDeviceTapListKey: @[tapConfiguration],
        };
        status = AudioHardwareCreateAggregateDevice(
            (__bridge CFDictionaryRef)aggregateConfiguration,
            &PearWallState.aggregateDeviceID);
        if (status != noErr) {
            pearwall_macos_audio_cleanup();
            return status;
        }

        PearWallState.callback = callback;
        PearWallState.context = context;
        PearWallAudioCallback capturedCallback = callback;
        void *capturedContext = context;
        double sampleRate = format.mSampleRate;
        dispatch_queue_t queue = dispatch_queue_create(
            "com.nevoit.pearwall.audio-callback",
            DISPATCH_QUEUE_SERIAL_WITH_AUTORELEASE_POOL);
        status = AudioDeviceCreateIOProcIDWithBlock(
            &PearWallState.ioProcID,
            PearWallState.aggregateDeviceID,
            queue,
            ^(const AudioTimeStamp *now,
              const AudioBufferList *inputData,
              const AudioTimeStamp *inputTime,
              AudioBufferList *outputData,
              const AudioTimeStamp *outputTime) {
                (void)now;
                (void)inputTime;
                (void)outputData;
                (void)outputTime;
                if (inputData == NULL || inputData->mNumberBuffers == 0) {
                    return;
                }
                const AudioBuffer *buffer = &inputData->mBuffers[0];
                if (buffer->mData == NULL || buffer->mDataByteSize < sizeof(float)) {
                    return;
                }
                uint32_t frameCount = buffer->mDataByteSize / sizeof(float);
                capturedCallback((const float *)buffer->mData,
                                 frameCount,
                                 sampleRate,
                                 capturedContext);
            });
        if (status != noErr) {
            pearwall_macos_audio_cleanup();
            return status;
        }

        status = AudioDeviceStart(PearWallState.aggregateDeviceID,
                                  PearWallState.ioProcID);
        if (status != noErr) {
            pearwall_macos_audio_cleanup();
            return status;
        }
        PearWallState.running = YES;
        return noErr;
    }
}

void pearwall_macos_audio_stop(void) {
    @autoreleasepool {
        pearwall_macos_audio_cleanup();
    }
}
