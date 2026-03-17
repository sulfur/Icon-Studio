import ReactDOM from 'react-dom/client'

import App from './App'
import './style.css'

if (window.iconStudioDesktop?.isDesktop) {
  document.documentElement.classList.add('desktop-shell')
  document.body.classList.add('desktop-shell')
}

ReactDOM.createRoot(document.querySelector<HTMLDivElement>('#app')!).render(
  <>
    <App />
  </>,
)
