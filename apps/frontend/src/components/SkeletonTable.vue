<script setup lang="ts">
const props = withDefaults(defineProps<{ rows?: number; columns?: number }>(), {
  rows:    6,
  columns: 4,
})

const widths = ['w-24', 'w-32', 'w-20', 'w-36', 'w-28', 'w-16', 'w-40', 'w-12']

function cellWidth(col: number, row: number) {
  return widths[(col * 3 + row) % widths.length]
}
</script>

<template>
  <div class="skeleton-table">
    <!-- Header -->
    <div class="skeleton-row skeleton-header">
      <div
        v-for="c in props.columns"
        :key="c"
        class="skeleton-cell"
      >
        <div class="skeleton-bar w-20 h-3" />
      </div>
    </div>
    <!-- Body rows -->
    <div
      v-for="r in props.rows"
      :key="r"
      class="skeleton-row"
    >
      <div
        v-for="c in props.columns"
        :key="c"
        class="skeleton-cell"
      >
        <div :class="`skeleton-bar h-3 ${cellWidth(c, r)}`" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-table {
  border-radius: 8px;
  overflow: hidden;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid #1e1e24;
}

.skeleton-header {
  background: #1a1a1e;
}

.skeleton-cell {
  flex: 1;
  padding: 12px 16px;
}

.skeleton-bar {
  border-radius: 4px;
  background: linear-gradient(90deg, #1e1e24 25%, #272730 50%, #1e1e24 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
