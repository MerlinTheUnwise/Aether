#include "aether_runtime.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    /* ─── String tests ─── */
    AetherString s = aether_string_new("Hello World");
    assert(aether_string_length(s) == 11);
    assert(!aether_string_is_lowercase(s));
    AetherString lower = aether_string_to_lower(s);
    assert(aether_string_is_lowercase(lower));
    assert(aether_string_length(lower) == 11);

    AetherString s2 = aether_string_from_cstr("Hello World");
    assert(aether_string_equals(s, s2));

    AetherString trimmed = aether_string_new("  hello  ");
    assert(!aether_string_is_trimmed(trimmed));
    AetherString t = aether_string_trim(trimmed);
    assert(aether_string_is_trimmed(t));
    assert(aether_string_length(t) == 5);

    AetherString hay = aether_string_new("hello world");
    AetherString needle = aether_string_new("world");
    assert(aether_string_contains(hay, needle));
    AetherString miss = aether_string_new("xyz");
    assert(!aether_string_contains(hay, miss));

    aether_string_free(&s);
    aether_string_free(&s2);
    aether_string_free(&lower);
    aether_string_free(&trimmed);
    aether_string_free(&t);
    aether_string_free(&hay);
    aether_string_free(&needle);
    aether_string_free(&miss);

    /* ─── Confidence tests ─── */
    aether_confidence_init(0.7);
    aether_confidence_propagate_named("node_a", 0.95);
    assert(aether_confidence_check(0.95, 0.7) == 1);
    assert(aether_confidence_check(0.5, 0.7) == 0);
    assert(aether_confidence_get("node_a") == 0.95);

    /* ─── Contract tests ─── */
    aether_contract_set_mode(AETHER_CONTRACT_COUNT);
    aether_contract_assert(1, "should pass");
    assert(aether_contract_failure_count() == 0);
    aether_contract_assert(0, "should fail");
    assert(aether_contract_failure_count() == 1);

    /* ─── Arena tests ─── */
    AetherArena arena = aether_arena_new(4096);
    void* p = aether_arena_alloc(&arena, 1024);
    assert(p != NULL);
    void* p2 = aether_arena_alloc(&arena, 1024);
    assert(p2 != NULL);
    assert(p2 != p);
    aether_arena_reset(&arena);
    void* p3 = aether_arena_alloc(&arena, 1024);
    assert(p3 == p);  /* after reset, same base address */
    aether_arena_free(&arena);

    /* ─── Global alloc tests ─── */
    aether_runtime_init(0.7, 2);
    void* ga = aether_alloc(1024);
    assert(ga != NULL);
    aether_runtime_finalize();

    /* ─── Effect log tests ─── */
    AetherEffectLog elog = aether_effect_log_new();
    aether_effect_log_record(&elog, "node1", "database.read");
    aether_effect_log_record(&elog, "node2", "network.send");
    assert(elog.count == 2);
    aether_effect_log_free(&elog);

    /* ─── Error state tests ─── */
    assert(!aether_has_error());
    aether_set_error(AETHER_ERROR_TIMEOUT, "timed out");
    assert(aether_has_error());
    AetherError* err = aether_get_error();
    assert(err->code == AETHER_ERROR_TIMEOUT);
    aether_clear_error();
    assert(!aether_has_error());

    /* ─── Recovery tests ─── */
    aether_recovery_enter("test_node");
    aether_recovery_set_condition("timeout");
    assert(aether_string_eq_cstr(aether_recovery_get_condition(), "timeout"));
    aether_recovery_exit("test_node");

    /* ─── Execution log tests ─── */
    AetherExecutionLog xlog = aether_log_new();
    AetherNodeLog entry = { "test_node", 0.0, 1.5, 0.95, 0 };
    aether_log_record(&xlog, entry);
    assert(xlog.count == 1);
    aether_log_free(&xlog);

    /* ─── List tests ─── */
    AetherList list = aether_list_new(sizeof(int64_t));
    int64_t vals[] = { 10, 20, 30 };
    aether_list_push(&list, &vals[0]);
    aether_list_push(&list, &vals[1]);
    aether_list_push(&list, &vals[2]);
    assert(aether_list_length(&list) == 3);
    int64_t* got = (int64_t*)aether_list_get(&list, 1);
    assert(got != NULL && *got == 20);
    aether_list_free(&list);

    printf("All C runtime tests passed.\n");
    return 0;
}
