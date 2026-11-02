import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme } from './utils/theme'
import './styles/base.css'
import './styles/layout.css'
import './styles/wall.css'
import './styles/detail.css'
import './styles/form.css'
import './styles/settings.css'
import './styles/toast.css'

// Paint the boot screen in the user's theme straight away — the library
// (and with it the settings) only arrives a moment later.
const boot = window.storm.boot
if (boot) applyTheme(boot.theme, boot.mode, boot.accent)

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
