import { createApp } from 'vue'
import App from './App.vue'
const api = import.meta.env.VITE_API_URL
const mode = import.meta.env.MODE
createApp(App).provide('api', api).mount('#app')
