#ifndef AETHER_RUNTIME_H
#define AETHER_RUNTIME_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

/* ═══ String ═══ */
typedef struct { int64_t length; char* data; } AetherString;

AetherString aether_string_new(const char* data);
AetherString aether_string_copy(AetherString s);
void aether_string_free(AetherString* s);
int64_t aether_string_length(AetherString s);
bool aether_string_is_lowercase(AetherString s);
bool aether_string_is_trimmed(AetherString s);
bool aether_string_equals(AetherString a, AetherString b);
AetherString aether_string_to_lower(AetherString s);
AetherString aether_string_trim(AetherString s);

/* ═══ List (generic via void* + element size) ═══ */
typedef struct { int64_t length; void* data; int64_t capacity; int64_t element_size; } AetherList;

AetherList aether_list_new(int64_t element_size);
void aether_list_free(AetherList* list);
void aether_list_push(AetherList* list, const void* element);
void* aether_list_get(AetherList* list, int64_t index);
int64_t aether_list_length(AetherList* list);
bool aether_list_contains(AetherList* list, const void* element, bool (*eq)(const void*, const void*));
bool aether_list_is_distinct(AetherList* list, bool (*eq)(const void*, const void*));

/* ═══ Confidence ═══ */
typedef struct { double score; bool needs_oversight; } AetherConfidence;

AetherConfidence aether_confidence_new(double score, double threshold);
AetherConfidence aether_confidence_propagate(double node_confidence, AetherConfidence* inputs, int64_t count, double threshold);
double aether_min_confidence(double* values, int64_t count);

/* ═══ Effects ═══ */
typedef struct { const char** effects; int64_t count; int64_t capacity; } AetherEffectLog;

AetherEffectLog aether_effect_log_new(void);
void aether_effect_log_record(AetherEffectLog* log, const char* node_id, const char* effect);
void aether_effect_log_free(AetherEffectLog* log);

/* ═══ Contracts ═══ */
void aether_contract_violation(const char* node_id, const char* contract_type, const char* expression);

/* ═══ Error State ═══ */
typedef enum { AETHER_OK=0, AETHER_ERROR_TIMEOUT=1, AETHER_ERROR_NOT_FOUND=2, AETHER_ERROR_FORBIDDEN=3, AETHER_ERROR_GENERIC=99 } AetherErrorCode;
typedef struct { AetherErrorCode code; char message[256]; } AetherError;

void aether_set_error(AetherErrorCode code, const char* message);
AetherError* aether_get_error(void);
void aether_clear_error(void);
bool aether_has_error(void);

/* ═══ Recovery ═══ */
void aether_recovery_enter(const char* node_id);
void aether_recovery_exit(const char* node_id);
void aether_recovery_set_condition(const char* condition);
const char* aether_recovery_get_condition(void);
void aether_sleep_ms(int64_t milliseconds);
void aether_report_error(const char* node_id, const char* condition);
void aether_escalate(const char* node_id, const char* message);
int aether_was_escalated(void);
void aether_fatal(const char* message);
bool aether_string_eq_cstr(const char* a, const char* b);

/* ═══ Contracts (extended) ═══ */
typedef enum { AETHER_CONTRACT_ABORT=0, AETHER_CONTRACT_LOG=1, AETHER_CONTRACT_COUNT=2 } AetherContractMode;

void aether_contract_set_mode(AetherContractMode mode);
void aether_contract_assert(bool condition, const char* description);
void aether_contract_adversarial(bool condition, const char* description);
int64_t aether_contract_failure_count(void);

/* ═══ Confidence (extended) ═══ */
void aether_confidence_set(const char* node_id, double value);
double aether_confidence_get(const char* node_id);
void aether_log_skip(const char* node_id, double confidence);

/* ═══ Memory Arena ═══ */
typedef struct { char* base; int64_t size; int64_t offset; } AetherArena;

AetherArena aether_arena_new(int64_t size);
void* aether_arena_alloc(AetherArena* arena, int64_t bytes);
void aether_arena_reset(AetherArena* arena);
void aether_arena_free(AetherArena* arena);

/* ═══ Execution Timing ═══ */
typedef struct { const char* node_id; double start_ms; double end_ms; double confidence; bool skipped; } AetherNodeLog;
typedef struct { AetherNodeLog* entries; int64_t count; int64_t capacity; double total_ms; } AetherExecutionLog;

AetherExecutionLog aether_log_new(void);
void aether_log_record(AetherExecutionLog* log, AetherNodeLog entry);
void aether_log_print(AetherExecutionLog* log);
void aether_log_free(AetherExecutionLog* log);
double aether_time_ms(void);

/* ═══ Thread Pool (Parallel Wave Execution) ═══ */
typedef struct AetherThreadPool AetherThreadPool;
typedef void (*AetherTaskFn)(void* arg, void* result);
typedef struct { AetherTaskFn fn; void* arg; void* result; bool completed; } AetherTask;

AetherThreadPool* aether_pool_new(int64_t num_threads);
AetherTask* aether_pool_submit(AetherThreadPool* pool, AetherTaskFn fn, void* arg, void* result_buf);
void aether_pool_wait_all(AetherThreadPool* pool);
void aether_pool_free(AetherThreadPool* pool);
int64_t aether_get_num_cores(void);

typedef struct { AetherTask* tasks; int64_t task_count; double start_ms; double end_ms; } AetherWave;
void aether_execute_wave(AetherThreadPool* pool, AetherWave* wave);

#endif
