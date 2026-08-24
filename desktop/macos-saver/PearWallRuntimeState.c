#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

enum {
    PEARWALL_RUNTIME_STATE_VERSION = 1,
    PEARWALL_RUNTIME_STATE_SIZE = 64,
};

typedef struct {
    uint8_t magic[8];
    uint32_t version;
    uint32_t size;
    _Atomic uint32_t sequence;
    _Atomic uint32_t pulse_bits;
    _Atomic uint32_t playing;
    uint32_t reserved_value;
    _Atomic uint64_t updated_at_milliseconds;
    _Atomic uint64_t settings_revision;
    uint8_t reserved[16];
} PearWallRuntimeState;

_Static_assert(sizeof(PearWallRuntimeState) == PEARWALL_RUNTIME_STATE_SIZE, "invalid runtime state size");

typedef struct {
    const PearWallRuntimeState *state;
} PearWallRuntimeStateReader;

static const uint8_t pearwall_runtime_magic[8] = {
    'P', 'W', 'R', 'S', 'T', 'A', 'T', 'E',
};

void *pearwall_runtime_state_open(const char *path) {
    if (path == NULL) {
        return NULL;
    }
    int descriptor = open(path, O_RDONLY | O_CLOEXEC);
    if (descriptor < 0) {
        return NULL;
    }
    struct stat attributes;
    if (fstat(descriptor, &attributes) != 0 ||
        attributes.st_size < PEARWALL_RUNTIME_STATE_SIZE) {
        close(descriptor);
        return NULL;
    }
    void *mapping = mmap(
        NULL,
        PEARWALL_RUNTIME_STATE_SIZE,
        PROT_READ,
        MAP_SHARED,
        descriptor,
        0
    );
    close(descriptor);
    if (mapping == MAP_FAILED) {
        return NULL;
    }
    const PearWallRuntimeState *state = mapping;
    if (memcmp(state->magic, pearwall_runtime_magic, sizeof(pearwall_runtime_magic)) != 0 ||
        state->version != PEARWALL_RUNTIME_STATE_VERSION ||
        state->size != PEARWALL_RUNTIME_STATE_SIZE) {
        munmap(mapping, PEARWALL_RUNTIME_STATE_SIZE);
        return NULL;
    }
    PearWallRuntimeStateReader *reader = calloc(1, sizeof(*reader));
    if (reader == NULL) {
        munmap(mapping, PEARWALL_RUNTIME_STATE_SIZE);
        return NULL;
    }
    reader->state = state;
    return reader;
}

int32_t pearwall_runtime_state_read(
    void *opaque_reader,
    float *pulse,
    uint64_t *updated_at_milliseconds
) {
    if (opaque_reader == NULL || pulse == NULL || updated_at_milliseconds == NULL) {
        return 0;
    }
    const PearWallRuntimeStateReader *reader = opaque_reader;
    const PearWallRuntimeState *state = reader->state;
    for (int attempt = 0; attempt < 8; attempt += 1) {
        uint32_t first = atomic_load_explicit(&state->sequence, memory_order_acquire);
        if ((first & 1U) != 0) {
            continue;
        }
        uint32_t pulse_bits = atomic_load_explicit(&state->pulse_bits, memory_order_relaxed);
        uint64_t updated = atomic_load_explicit(
            &state->updated_at_milliseconds,
            memory_order_relaxed
        );
        uint32_t second = atomic_load_explicit(&state->sequence, memory_order_acquire);
        if (first != second || (second & 1U) != 0) {
            continue;
        }
        memcpy(pulse, &pulse_bits, sizeof(pulse_bits));
        *updated_at_milliseconds = updated;
        return 1;
    }
    return 0;
}

void pearwall_runtime_state_close(void *opaque_reader) {
    if (opaque_reader == NULL) {
        return;
    }
    PearWallRuntimeStateReader *reader = opaque_reader;
    munmap((void *)reader->state, PEARWALL_RUNTIME_STATE_SIZE);
    free(reader);
}
