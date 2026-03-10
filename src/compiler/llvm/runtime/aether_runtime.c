/**
 * AETHER Native Runtime Library
 *
 * Provides the C runtime functions that compiled AETHER binaries link against.
 * Every @aether_* function declared in the generated LLVM IR is implemented here.
 */

#include "aether_runtime.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#include <unistd.h>
#endif

/* ═══ String ═══ */

AetherString aether_string_new(const char* data) {
    AetherString s;
    if (!data) {
        s.length = 0;
        s.data = NULL;
        return s;
    }
    s.length = (int64_t)strlen(data);
    s.data = (char*)malloc((size_t)s.length + 1);
    if (s.data) {
        memcpy(s.data, data, (size_t)s.length + 1);
    } else {
        s.length = 0;
    }
    return s;
}

AetherString aether_string_copy(AetherString s) {
    AetherString copy;
    copy.length = s.length;
    if (s.data && s.length > 0) {
        copy.data = (char*)malloc((size_t)s.length + 1);
        if (copy.data) {
            memcpy(copy.data, s.data, (size_t)s.length + 1);
        } else {
            copy.length = 0;
        }
    } else {
        copy.data = NULL;
        copy.length = 0;
    }
    return copy;
}

void aether_string_free(AetherString* s) {
    if (s && s->data) {
        free(s->data);
        s->data = NULL;
        s->length = 0;
    }
}

int64_t aether_string_length(AetherString s) {
    return s.length;
}

bool aether_string_is_lowercase(AetherString s) {
    if (!s.data) return true;
    for (int64_t i = 0; i < s.length; i++) {
        if (isupper((unsigned char)s.data[i])) return false;
    }
    return true;
}

bool aether_string_is_trimmed(AetherString s) {
    if (!s.data || s.length == 0) return true;
    if (isspace((unsigned char)s.data[0])) return false;
    if (isspace((unsigned char)s.data[s.length - 1])) return false;
    return true;
}

bool aether_string_equals(AetherString a, AetherString b) {
    if (a.length != b.length) return false;
    if (a.length == 0) return true;
    if (!a.data || !b.data) return a.data == b.data;
    return memcmp(a.data, b.data, (size_t)a.length) == 0;
}

AetherString aether_string_to_lower(AetherString s) {
    AetherString result = aether_string_copy(s);
    if (result.data) {
        for (int64_t i = 0; i < result.length; i++) {
            result.data[i] = (char)tolower((unsigned char)result.data[i]);
        }
    }
    return result;
}

AetherString aether_string_trim(AetherString s) {
    if (!s.data || s.length == 0) {
        AetherString empty = { 0, NULL };
        return empty;
    }
    int64_t start = 0;
    while (start < s.length && isspace((unsigned char)s.data[start])) start++;
    int64_t end = s.length;
    while (end > start && isspace((unsigned char)s.data[end - 1])) end--;

    int64_t new_len = end - start;
    AetherString result;
    result.length = new_len;
    result.data = (char*)malloc((size_t)new_len + 1);
    if (result.data) {
        memcpy(result.data, s.data + start, (size_t)new_len);
        result.data[new_len] = '\0';
    } else {
        result.length = 0;
    }
    return result;
}

/* ═══ List ═══ */

AetherList aether_list_new(int64_t element_size) {
    AetherList list;
    list.length = 0;
    list.capacity = 8;
    list.element_size = element_size;
    list.data = malloc((size_t)(list.capacity * element_size));
    if (!list.data) {
        list.capacity = 0;
    }
    return list;
}

void aether_list_free(AetherList* list) {
    if (list && list->data) {
        free(list->data);
        list->data = NULL;
        list->length = 0;
        list->capacity = 0;
    }
}

void aether_list_push(AetherList* list, const void* element) {
    if (!list || !element) return;
    if (list->length >= list->capacity) {
        int64_t new_cap = list->capacity == 0 ? 8 : list->capacity * 2;
        void* new_data = realloc(list->data, (size_t)(new_cap * list->element_size));
        if (!new_data) return;
        list->data = new_data;
        list->capacity = new_cap;
    }
    memcpy((char*)list->data + list->length * list->element_size, element, (size_t)list->element_size);
    list->length++;
}

void* aether_list_get(AetherList* list, int64_t index) {
    if (!list || index < 0 || index >= list->length) return NULL;
    return (char*)list->data + index * list->element_size;
}

int64_t aether_list_length(AetherList* list) {
    return list ? list->length : 0;
}

bool aether_list_contains(AetherList* list, const void* element, bool (*eq)(const void*, const void*)) {
    if (!list || !element || !eq) return false;
    for (int64_t i = 0; i < list->length; i++) {
        void* item = (char*)list->data + i * list->element_size;
        if (eq(item, element)) return true;
    }
    return false;
}

bool aether_list_is_distinct(AetherList* list, bool (*eq)(const void*, const void*)) {
    if (!list || !eq) return true;
    for (int64_t i = 0; i < list->length; i++) {
        void* a = (char*)list->data + i * list->element_size;
        for (int64_t j = i + 1; j < list->length; j++) {
            void* b = (char*)list->data + j * list->element_size;
            if (eq(a, b)) return false;
        }
    }
    return true;
}

/* ═══ Confidence ═══ */

AetherConfidence aether_confidence_new(double score, double threshold) {
    AetherConfidence c;
    c.score = score;
    c.needs_oversight = score < threshold;
    return c;
}

AetherConfidence aether_confidence_propagate(double node_confidence, AetherConfidence* inputs, int64_t count, double threshold) {
    double min_input = 1.0;
    for (int64_t i = 0; i < count; i++) {
        if (inputs[i].score < min_input) {
            min_input = inputs[i].score;
        }
    }
    double propagated = node_confidence * min_input;
    return aether_confidence_new(propagated, threshold);
}

double aether_min_confidence(double* values, int64_t count) {
    if (!values || count <= 0) return 1.0;
    double min_val = values[0];
    for (int64_t i = 1; i < count; i++) {
        if (values[i] < min_val) min_val = values[i];
    }
    return min_val;
}

/* ═══ Effects ═══ */

AetherEffectLog aether_effect_log_new(void) {
    AetherEffectLog log;
    log.count = 0;
    log.capacity = 16;
    log.effects = (const char**)malloc((size_t)log.capacity * sizeof(const char*));
    if (!log.effects) {
        log.capacity = 0;
    }
    return log;
}

void aether_effect_log_record(AetherEffectLog* log, const char* node_id, const char* effect) {
    if (!log || !node_id || !effect) return;
    if (log->count >= log->capacity) {
        int64_t new_cap = log->capacity == 0 ? 16 : log->capacity * 2;
        const char** new_effects = (const char**)realloc(log->effects, (size_t)new_cap * sizeof(const char*));
        if (!new_effects) return;
        log->effects = new_effects;
        log->capacity = new_cap;
    }
    /* Format: "node_id:effect" — caller-owned strings, we just store the pointer */
    size_t len = strlen(node_id) + 1 + strlen(effect) + 1;
    char* entry = (char*)malloc(len);
    if (!entry) return;
    snprintf(entry, len, "%s:%s", node_id, effect);
    log->effects[log->count++] = entry;
}

void aether_effect_log_free(AetherEffectLog* log) {
    if (!log) return;
    for (int64_t i = 0; i < log->count; i++) {
        free((void*)log->effects[i]);
    }
    free(log->effects);
    log->effects = NULL;
    log->count = 0;
    log->capacity = 0;
}

/* ═══ Contracts ═══ */

/* Contract mode and failure count — used by both contract_violation and contract_assert */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L && !defined(__STDC_NO_THREADS__)
static _Thread_local AetherContractMode tls_contract_mode = AETHER_CONTRACT_ABORT;
static _Thread_local int64_t tls_contract_failures = 0;
#else
static AetherContractMode tls_contract_mode = AETHER_CONTRACT_ABORT;
static int64_t tls_contract_failures = 0;
#endif

void aether_contract_violation(const char* node_id, const char* contract_type, const char* expression) {
    fprintf(stderr, "AETHER CONTRACT VIOLATION [%s] %s: %s\n",
            node_id ? node_id : "unknown",
            contract_type ? contract_type : "unknown",
            expression ? expression : "(no expression)");
    if (tls_contract_mode == AETHER_CONTRACT_ABORT) {
        abort();
    }
}

/* ═══ Error State ═══ */

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L && !defined(__STDC_NO_THREADS__)
static _Thread_local AetherError tls_error = { AETHER_OK, "" };
#else
static AetherError tls_error = { AETHER_OK, "" };
#endif

void aether_set_error(AetherErrorCode code, const char* message) {
    tls_error.code = code;
    if (message) {
        strncpy(tls_error.message, message, sizeof(tls_error.message) - 1);
        tls_error.message[sizeof(tls_error.message) - 1] = '\0';
    } else {
        tls_error.message[0] = '\0';
    }
}

AetherError* aether_get_error(void) {
    return &tls_error;
}

void aether_clear_error(void) {
    tls_error.code = AETHER_OK;
    tls_error.message[0] = '\0';
}

bool aether_has_error(void) {
    return tls_error.code != AETHER_OK;
}

/* ═══ Recovery ═══ */

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L && !defined(__STDC_NO_THREADS__)
static _Thread_local const char* tls_recovery_condition = NULL;
static _Thread_local const char* tls_recovery_node = NULL;
static _Thread_local int tls_escalated = 0;
#else
static const char* tls_recovery_condition = NULL;
static const char* tls_recovery_node = NULL;
static int tls_escalated = 0;
#endif

void aether_recovery_enter(const char* node_id) {
    tls_recovery_node = node_id;
    tls_recovery_condition = NULL;
}

void aether_recovery_exit(const char* node_id) {
    (void)node_id;
    tls_recovery_node = NULL;
    tls_recovery_condition = NULL;
}

void aether_recovery_set_condition(const char* condition) {
    tls_recovery_condition = condition;
}

const char* aether_recovery_get_condition(void) {
    return tls_recovery_condition ? tls_recovery_condition : "";
}

void aether_sleep_ms(int64_t milliseconds) {
    if (milliseconds <= 0) return;
#ifdef _WIN32
    Sleep((DWORD)milliseconds);
#else
    struct timespec ts;
    ts.tv_sec = (time_t)(milliseconds / 1000);
    ts.tv_nsec = (long)((milliseconds % 1000) * 1000000);
    nanosleep(&ts, NULL);
#endif
}

void aether_report_error(const char* node_id, const char* condition) {
    fprintf(stderr, "AETHER RECOVERY [%s]: %s\n",
            node_id ? node_id : "unknown",
            condition ? condition : "(no condition)");
}

void aether_escalate(const char* node_id, const char* message) {
    fprintf(stderr, "AETHER ESCALATION [%s]: %s\n",
            node_id ? node_id : "unknown",
            message ? message : "(no message)");
    tls_escalated = 1;
}

int aether_was_escalated(void) {
    return tls_escalated;
}

void aether_fatal(const char* message) {
    fprintf(stderr, "AETHER FATAL: %s\n", message ? message : "unhandled recovery");
    abort();
}

bool aether_string_eq_cstr(const char* a, const char* b) {
    if (!a || !b) return a == b;
    return strcmp(a, b) == 0;
}

/* ═══ Contracts (extended) ═══ */

void aether_contract_set_mode(AetherContractMode mode) {
    tls_contract_mode = mode;
}

void aether_contract_assert(bool condition, const char* description) {
    if (condition) return;
    tls_contract_failures++;
    switch (tls_contract_mode) {
        case AETHER_CONTRACT_ABORT:
            fprintf(stderr, "AETHER CONTRACT ASSERT FAILED: %s\n", description ? description : "(no description)");
            abort();
        case AETHER_CONTRACT_LOG:
            fprintf(stderr, "AETHER CONTRACT ASSERT FAILED: %s\n", description ? description : "(no description)");
            break;
        case AETHER_CONTRACT_COUNT:
            break;
    }
}

void aether_contract_adversarial(bool triggered, const char* description) {
    if (!triggered) return;
    tls_contract_failures++;
    switch (tls_contract_mode) {
        case AETHER_CONTRACT_ABORT:
            fprintf(stderr, "AETHER ADVERSARIAL CHECK TRIGGERED: %s\n", description ? description : "(no description)");
            abort();
        case AETHER_CONTRACT_LOG:
            fprintf(stderr, "AETHER ADVERSARIAL CHECK TRIGGERED: %s\n", description ? description : "(no description)");
            break;
        case AETHER_CONTRACT_COUNT:
            break;
    }
}

int64_t aether_contract_failure_count(void) {
    return tls_contract_failures;
}

/* ═══ Confidence (extended) ═══ */

#define AETHER_MAX_CONFIDENCE_ENTRIES 256
static struct { const char* node_id; double value; } confidence_store[AETHER_MAX_CONFIDENCE_ENTRIES];
static int64_t confidence_store_count = 0;

void aether_confidence_set(const char* node_id, double value) {
    for (int64_t i = 0; i < confidence_store_count; i++) {
        if (confidence_store[i].node_id && strcmp(confidence_store[i].node_id, node_id) == 0) {
            confidence_store[i].value = value;
            return;
        }
    }
    if (confidence_store_count < AETHER_MAX_CONFIDENCE_ENTRIES) {
        confidence_store[confidence_store_count].node_id = node_id;
        confidence_store[confidence_store_count].value = value;
        confidence_store_count++;
    }
}

double aether_confidence_get(const char* node_id) {
    for (int64_t i = 0; i < confidence_store_count; i++) {
        if (confidence_store[i].node_id && strcmp(confidence_store[i].node_id, node_id) == 0) {
            return confidence_store[i].value;
        }
    }
    return 1.0;
}

void aether_log_skip(const char* node_id, double confidence) {
    fprintf(stderr, "AETHER SKIP [%s]: confidence %.4f below threshold\n",
            node_id ? node_id : "unknown", confidence);
}

/* ═══ Memory Arena ═══ */

AetherArena aether_arena_new(int64_t size) {
    AetherArena arena;
    arena.size = size;
    arena.offset = 0;
    arena.base = (char*)malloc((size_t)size);
    if (!arena.base) {
        arena.size = 0;
    }
    return arena;
}

void* aether_arena_alloc(AetherArena* arena, int64_t bytes) {
    if (!arena || !arena->base) return NULL;
    /* Align to 8 bytes */
    int64_t aligned = (bytes + 7) & ~7;
    if (arena->offset + aligned > arena->size) return NULL;
    void* ptr = arena->base + arena->offset;
    arena->offset += aligned;
    return ptr;
}

void aether_arena_reset(AetherArena* arena) {
    if (arena) arena->offset = 0;
}

void aether_arena_free(AetherArena* arena) {
    if (arena && arena->base) {
        free(arena->base);
        arena->base = NULL;
        arena->size = 0;
        arena->offset = 0;
    }
}

/* ═══ Execution Timing ═══ */

AetherExecutionLog aether_log_new(void) {
    AetherExecutionLog log;
    log.count = 0;
    log.capacity = 32;
    log.total_ms = 0.0;
    log.entries = (AetherNodeLog*)malloc((size_t)log.capacity * sizeof(AetherNodeLog));
    if (!log.entries) {
        log.capacity = 0;
    }
    return log;
}

void aether_log_record(AetherExecutionLog* log, AetherNodeLog entry) {
    if (!log) return;
    if (log->count >= log->capacity) {
        int64_t new_cap = log->capacity == 0 ? 32 : log->capacity * 2;
        AetherNodeLog* new_entries = (AetherNodeLog*)realloc(log->entries, (size_t)new_cap * sizeof(AetherNodeLog));
        if (!new_entries) return;
        log->entries = new_entries;
        log->capacity = new_cap;
    }
    log->entries[log->count++] = entry;
    double duration = entry.end_ms - entry.start_ms;
    if (duration > 0) log->total_ms += duration;
}

void aether_log_print(AetherExecutionLog* log) {
    if (!log) return;
    fprintf(stdout, "═══ AETHER Execution Log ═══\n");
    for (int64_t i = 0; i < log->count; i++) {
        AetherNodeLog* e = &log->entries[i];
        fprintf(stdout, "  [%s] %.3fms conf=%.2f%s\n",
                e->node_id ? e->node_id : "?",
                e->end_ms - e->start_ms,
                e->confidence,
                e->skipped ? " SKIPPED" : "");
    }
    fprintf(stdout, "  Total: %.3fms (%lld nodes)\n", log->total_ms, (long long)log->count);
}

void aether_log_free(AetherExecutionLog* log) {
    if (log && log->entries) {
        free(log->entries);
        log->entries = NULL;
        log->count = 0;
        log->capacity = 0;
    }
}

double aether_time_ms(void) {
    return (double)clock() / (double)CLOCKS_PER_SEC * 1000.0;
}

/* ═══ Runtime Init/Finalize ═══ */

static double global_confidence_threshold = 0.7;
static AetherArena global_arena = { NULL, 0, 0 };

void aether_runtime_init(double confidence_threshold, int contract_mode) {
    global_confidence_threshold = confidence_threshold;
    aether_contract_set_mode((AetherContractMode)contract_mode);
    tls_contract_failures = 0;
    confidence_store_count = 0;
    tls_escalated = 0;
    aether_clear_error();
    global_arena = aether_arena_new(1048576);  /* 1MB default arena */
}

void aether_runtime_finalize(void) {
    aether_arena_free(&global_arena);
}

/* ═══ String helpers ═══ */

AetherString aether_string_from_cstr(const char* s) {
    return aether_string_new(s);
}

bool aether_string_contains(AetherString haystack, AetherString needle) {
    if (!haystack.data || !needle.data) return false;
    if (needle.length == 0) return true;
    if (needle.length > haystack.length) return false;
    for (int64_t i = 0; i <= haystack.length - needle.length; i++) {
        if (memcmp(haystack.data + i, needle.data, (size_t)needle.length) == 0) {
            return true;
        }
    }
    return false;
}

/* ═══ List helpers ═══ */

bool aether_list_is_sorted(AetherList* list, int (*cmp)(const void*, const void*)) {
    if (!list || !cmp || list->length <= 1) return true;
    for (int64_t i = 0; i < list->length - 1; i++) {
        void* a = (char*)list->data + i * list->element_size;
        void* b = (char*)list->data + (i + 1) * list->element_size;
        if (cmp(a, b) > 0) return false;
    }
    return true;
}

bool aether_list_has_duplicates(AetherList* list, bool (*eq)(const void*, const void*)) {
    return !aether_list_is_distinct(list, eq);
}

/* ═══ Confidence helpers ═══ */

void aether_confidence_init(double threshold) {
    global_confidence_threshold = threshold;
    confidence_store_count = 0;
}

int aether_confidence_check(double value, double threshold) {
    return value >= threshold ? 1 : 0;
}

void aether_confidence_propagate_named(const char* node_id, double value) {
    aether_confidence_set(node_id, value);
}

void aether_confidence_report(void) {
    fprintf(stdout, "═══ AETHER Confidence Report ═══\n");
    for (int64_t i = 0; i < confidence_store_count; i++) {
        fprintf(stdout, "  [%s] %.4f%s\n",
                confidence_store[i].node_id,
                confidence_store[i].value,
                confidence_store[i].value < global_confidence_threshold ? " (BELOW THRESHOLD)" : "");
    }
    fprintf(stdout, "  Total entries: %lld\n", (long long)confidence_store_count);
}

/* ═══ Effects helpers ═══ */

void aether_effect_declare(const char* node_id, const char* effect) {
    (void)node_id;
    (void)effect;
    /* Declaration is a compile-time concept; at runtime, just a no-op */
}

int aether_effect_check_violations(AetherEffectLog* log, const char** allowed, int64_t count) {
    if (!log || !allowed) return 0;
    int violations = 0;
    for (int64_t i = 0; i < log->count; i++) {
        bool found = false;
        for (int64_t j = 0; j < count; j++) {
            if (strstr(log->effects[i], allowed[j]) != NULL) {
                found = true;
                break;
            }
        }
        if (!found) violations++;
    }
    return violations;
}

void aether_effect_report(AetherEffectLog* log) {
    if (!log) return;
    fprintf(stdout, "═══ AETHER Effect Report ═══\n");
    for (int64_t i = 0; i < log->count; i++) {
        fprintf(stdout, "  %s\n", log->effects[i]);
    }
    fprintf(stdout, "  Total effects: %lld\n", (long long)log->count);
}

/* ═══ Arena helpers ═══ */

void* aether_alloc(int64_t bytes) {
    void* p = aether_arena_alloc(&global_arena, bytes);
    if (!p) {
        /* Fall back to malloc if arena is exhausted */
        return malloc((size_t)bytes);
    }
    return p;
}

/* ═══ Thread Pool ═══ */

#ifdef _WIN32

/* Windows thread pool using Win32 threads */

typedef struct AetherWorkItem {
    AetherTask* task;
    struct AetherWorkItem* next;
} AetherWorkItem;

struct AetherThreadPool {
    HANDLE* threads;
    int64_t num_threads;
    AetherWorkItem* queue_head;
    AetherWorkItem* queue_tail;
    CRITICAL_SECTION mutex;
    CONDITION_VARIABLE work_available;
    CONDITION_VARIABLE all_done;
    int64_t pending_count;
    bool shutdown;
};

static DWORD WINAPI pool_worker(LPVOID arg) {
    AetherThreadPool* pool = (AetherThreadPool*)arg;
    while (1) {
        EnterCriticalSection(&pool->mutex);
        while (!pool->queue_head && !pool->shutdown) {
            SleepConditionVariableCS(&pool->work_available, &pool->mutex, INFINITE);
        }
        if (pool->shutdown && !pool->queue_head) {
            LeaveCriticalSection(&pool->mutex);
            return 0;
        }
        AetherWorkItem* item = pool->queue_head;
        pool->queue_head = item->next;
        if (!pool->queue_head) pool->queue_tail = NULL;
        LeaveCriticalSection(&pool->mutex);

        item->task->fn(item->task->arg, item->task->result);
        item->task->completed = true;

        EnterCriticalSection(&pool->mutex);
        pool->pending_count--;
        if (pool->pending_count == 0) {
            WakeAllConditionVariable(&pool->all_done);
        }
        LeaveCriticalSection(&pool->mutex);
        free(item);
    }
}

int64_t aether_get_num_cores(void) {
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    return (int64_t)si.dwNumberOfProcessors;
}

AetherThreadPool* aether_pool_new(int64_t num_threads) {
    if (num_threads <= 0) num_threads = aether_get_num_cores();
    AetherThreadPool* pool = (AetherThreadPool*)calloc(1, sizeof(AetherThreadPool));
    if (!pool) return NULL;
    pool->num_threads = num_threads;
    pool->queue_head = NULL;
    pool->queue_tail = NULL;
    pool->pending_count = 0;
    pool->shutdown = false;
    InitializeCriticalSection(&pool->mutex);
    InitializeConditionVariable(&pool->work_available);
    InitializeConditionVariable(&pool->all_done);
    pool->threads = (HANDLE*)malloc((size_t)num_threads * sizeof(HANDLE));
    if (!pool->threads) { free(pool); return NULL; }
    for (int64_t i = 0; i < num_threads; i++) {
        pool->threads[i] = CreateThread(NULL, 0, pool_worker, pool, 0, NULL);
    }
    return pool;
}

AetherTask* aether_pool_submit(AetherThreadPool* pool, AetherTaskFn fn, void* arg, void* result_buf) {
    if (!pool || !fn) return NULL;
    AetherTask* task = (AetherTask*)calloc(1, sizeof(AetherTask));
    if (!task) return NULL;
    task->fn = fn;
    task->arg = arg;
    task->result = result_buf;
    task->completed = false;

    AetherWorkItem* item = (AetherWorkItem*)malloc(sizeof(AetherWorkItem));
    if (!item) { free(task); return NULL; }
    item->task = task;
    item->next = NULL;

    EnterCriticalSection(&pool->mutex);
    if (pool->queue_tail) {
        pool->queue_tail->next = item;
    } else {
        pool->queue_head = item;
    }
    pool->queue_tail = item;
    pool->pending_count++;
    WakeConditionVariable(&pool->work_available);
    LeaveCriticalSection(&pool->mutex);
    return task;
}

void aether_pool_wait_all(AetherThreadPool* pool) {
    if (!pool) return;
    EnterCriticalSection(&pool->mutex);
    while (pool->pending_count > 0) {
        SleepConditionVariableCS(&pool->all_done, &pool->mutex, INFINITE);
    }
    LeaveCriticalSection(&pool->mutex);
}

void aether_pool_free(AetherThreadPool* pool) {
    if (!pool) return;
    EnterCriticalSection(&pool->mutex);
    pool->shutdown = true;
    WakeAllConditionVariable(&pool->work_available);
    LeaveCriticalSection(&pool->mutex);
    for (int64_t i = 0; i < pool->num_threads; i++) {
        WaitForSingleObject(pool->threads[i], INFINITE);
        CloseHandle(pool->threads[i]);
    }
    DeleteCriticalSection(&pool->mutex);
    free(pool->threads);
    /* Free remaining queue items */
    AetherWorkItem* item = pool->queue_head;
    while (item) {
        AetherWorkItem* next = item->next;
        free(item);
        item = next;
    }
    free(pool);
}

#else

/* POSIX thread pool using pthreads */

typedef struct AetherWorkItem {
    AetherTask* task;
    struct AetherWorkItem* next;
} AetherWorkItem;

struct AetherThreadPool {
    pthread_t* threads;
    int64_t num_threads;
    AetherWorkItem* queue_head;
    AetherWorkItem* queue_tail;
    pthread_mutex_t mutex;
    pthread_cond_t work_available;
    pthread_cond_t all_done;
    int64_t pending_count;
    bool shutdown;
};

static void* pool_worker(void* arg) {
    AetherThreadPool* pool = (AetherThreadPool*)arg;
    while (1) {
        pthread_mutex_lock(&pool->mutex);
        while (!pool->queue_head && !pool->shutdown) {
            pthread_cond_wait(&pool->work_available, &pool->mutex);
        }
        if (pool->shutdown && !pool->queue_head) {
            pthread_mutex_unlock(&pool->mutex);
            return NULL;
        }
        AetherWorkItem* item = pool->queue_head;
        pool->queue_head = item->next;
        if (!pool->queue_head) pool->queue_tail = NULL;
        pthread_mutex_unlock(&pool->mutex);

        item->task->fn(item->task->arg, item->task->result);
        item->task->completed = true;

        pthread_mutex_lock(&pool->mutex);
        pool->pending_count--;
        if (pool->pending_count == 0) {
            pthread_cond_broadcast(&pool->all_done);
        }
        pthread_mutex_unlock(&pool->mutex);
        free(item);
    }
}

int64_t aether_get_num_cores(void) {
    long n = sysconf(_SC_NPROCESSORS_ONLN);
    return n > 0 ? (int64_t)n : 1;
}

AetherThreadPool* aether_pool_new(int64_t num_threads) {
    if (num_threads <= 0) num_threads = aether_get_num_cores();
    AetherThreadPool* pool = (AetherThreadPool*)calloc(1, sizeof(AetherThreadPool));
    if (!pool) return NULL;
    pool->num_threads = num_threads;
    pool->queue_head = NULL;
    pool->queue_tail = NULL;
    pool->pending_count = 0;
    pool->shutdown = false;
    pthread_mutex_init(&pool->mutex, NULL);
    pthread_cond_init(&pool->work_available, NULL);
    pthread_cond_init(&pool->all_done, NULL);
    pool->threads = (pthread_t*)malloc((size_t)num_threads * sizeof(pthread_t));
    if (!pool->threads) { free(pool); return NULL; }
    for (int64_t i = 0; i < num_threads; i++) {
        pthread_create(&pool->threads[i], NULL, pool_worker, pool);
    }
    return pool;
}

AetherTask* aether_pool_submit(AetherThreadPool* pool, AetherTaskFn fn, void* arg, void* result_buf) {
    if (!pool || !fn) return NULL;
    AetherTask* task = (AetherTask*)calloc(1, sizeof(AetherTask));
    if (!task) return NULL;
    task->fn = fn;
    task->arg = arg;
    task->result = result_buf;
    task->completed = false;

    AetherWorkItem* item = (AetherWorkItem*)malloc(sizeof(AetherWorkItem));
    if (!item) { free(task); return NULL; }
    item->task = task;
    item->next = NULL;

    pthread_mutex_lock(&pool->mutex);
    if (pool->queue_tail) {
        pool->queue_tail->next = item;
    } else {
        pool->queue_head = item;
    }
    pool->queue_tail = item;
    pool->pending_count++;
    pthread_cond_signal(&pool->work_available);
    pthread_mutex_unlock(&pool->mutex);
    return task;
}

void aether_pool_wait_all(AetherThreadPool* pool) {
    if (!pool) return;
    pthread_mutex_lock(&pool->mutex);
    while (pool->pending_count > 0) {
        pthread_cond_wait(&pool->all_done, &pool->mutex);
    }
    pthread_mutex_unlock(&pool->mutex);
}

void aether_pool_free(AetherThreadPool* pool) {
    if (!pool) return;
    pthread_mutex_lock(&pool->mutex);
    pool->shutdown = true;
    pthread_cond_broadcast(&pool->work_available);
    pthread_mutex_unlock(&pool->mutex);
    for (int64_t i = 0; i < pool->num_threads; i++) {
        pthread_join(pool->threads[i], NULL);
    }
    pthread_mutex_destroy(&pool->mutex);
    pthread_cond_destroy(&pool->work_available);
    pthread_cond_destroy(&pool->all_done);
    free(pool->threads);
    /* Free remaining queue items */
    AetherWorkItem* item = pool->queue_head;
    while (item) {
        AetherWorkItem* next = item->next;
        free(item);
        item = next;
    }
    free(pool);
}

#endif /* _WIN32 */

void aether_execute_wave(AetherThreadPool* pool, AetherWave* wave) {
    if (!pool || !wave || wave->task_count <= 0) return;
    wave->start_ms = aether_time_ms();
    for (int64_t i = 0; i < wave->task_count; i++) {
        AetherTask* t = &wave->tasks[i];
        aether_pool_submit(pool, t->fn, t->arg, t->result);
    }
    aether_pool_wait_all(pool);
    wave->end_ms = aether_time_ms();
}
