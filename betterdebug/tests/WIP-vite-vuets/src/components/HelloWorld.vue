<script setup lang="ts">
import { ref } from 'vue'

// defineProps<{ msg: string }>()

const count = ref(0)


// ELES FAZEM DIFERENTE!!!!! COM OO_.... n sei oq
// VER SE TEM BABEL VUE OU UM PARSER DE VUE PARA MODIFICAR OS SCRIPTS DO VUE SEM FICAR BUGADO POIS ELE PROCESSA SO TS JS O MEU SCRIPT.


let ovo = 0;
// @ts-ignore
let result = 55 * 5 + ovo;
console.log(result);
</script>

<template>
  <!-- <h1>{{ msg }}</h1> -->

  <div class="card">
    <button type="button" @click="count++">count is {{ count }}</button>
    <p>
      Edit
      <code>components/HelloWorld.vue</code> to test HMR
    </p>
  </div>

  <p>
    Check out
    <a href="https://vuejs.org/guide/quick-start.html#local" target="_blank">create-vue</a>, the official Vue + Vite
    starter
  </p>
  <p>
    Learn more about IDE Support for Vue in the
    <a href="https://vuejs.org/guide/scaling-up/tooling.html#ide-support" target="_blank">Vue Docs Scaling up Guide</a>.
  </p>
  <p class="read-the-docs">Click on the Vite and Vue logos to learn more</p>
</template>

<style scoped>
.read-the-docs {
  color: #888;
}
</style>
