import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import './Layout.css'

const links = [
  { to: '/', label: 'Overview', end: true },
  { to: '/collection', label: 'Box' },
  { to: '/decisions', label: 'Keep / Trade' },
  { to: '/import', label: 'Import' },
  { to: '/add', label: 'Add' },
]

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <div className="bg-atmosphere" aria-hidden="true" />
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">Keeper</span>
        </NavLink>
        <nav className="nav" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <p>Local-first · your box stays on this device</p>
      </footer>
    </div>
  )
}
