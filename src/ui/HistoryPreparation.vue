<script setup lang="ts">
import{computed}from'vue';
import type{IngestionProgress}from'../capture/ingestion-maintenance.ts';
import{historyPreparationView}from'./history-preparation.ts';
import AppCard from'./AppCard.vue';
const props=defineProps<{status?:IngestionProgress|null;compact?:boolean}>();
defineEmits<{open:[]}>();
const view=computed(()=>historyPreparationView(props.status));
</script>
<template>
 <button v-if="view && compact" class="history-compact capture-status-link" :title="view.detail" @click="$emit('open')">
  <span :class="['history-dot',view.tone]" aria-hidden="true" />
  <span>{{ view.label }}</span><small v-if="view.total">{{ view.completed }} / {{ view.total }}</small>
  <progress v-if="view.busy" :value="view.completed" :max="view.total" :aria-label="view.label" />
 </button>
 <AppCard v-else-if="view" as="section" padding="compact" class="history-preparation" role="status" aria-live="polite" aria-atomic="true">
  <div class="history-heading"><span :class="['history-dot',view.tone]" aria-hidden="true" /><strong>{{ view.label }}</strong><span class="history-count">{{ view.count }}</span></div>
  <progress v-if="view.busy" :value="view.completed" :max="view.total" :aria-label="view.label" />
  <p>{{ view.detail }}</p><small v-if="view.busy && view.current">{{ view.current }}</small>
 </AppCard>
</template>
<style scoped>
.history-preparation{margin:0 0 20px}.history-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.history-heading strong{font-size:var(--text-sm);font-weight:600}.history-count{margin-left:auto;color:var(--muted);font-size:var(--text-xs);font-variant-numeric:tabular-nums}.history-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--accent)}.history-dot.ready{background:var(--green,var(--accent))}.history-dot.attention{background:var(--orange,var(--accent))}progress{width:100%;height:5px;margin-top:12px;accent-color:var(--accent)}p{margin:8px 0 0;font-size:var(--text-sm);line-height:1.5;color:var(--muted)}small{color:var(--muted);font-size:var(--text-xs)}.history-compact{max-width:40vw;overflow:hidden;display:flex;align-items:center;gap:7px;white-space:nowrap}.history-compact>span:not(.history-dot){overflow:hidden;text-overflow:ellipsis}.history-compact progress{width:60px;min-width:40px;margin:0}.history-compact small{font-variant-numeric:tabular-nums}
</style>
