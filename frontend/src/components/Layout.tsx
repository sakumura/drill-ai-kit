import { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { isDebugMode } from '../lib/api'
import { SaveStatusBadge } from './SaveStatusBadge'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const isDebug = isDebugMode()
  const debugSuffix = isDebug ? '?debug' : ''

  return (
    <div className="app-shell">
      <div className="app-shell__frame">
        {/* 紙粒子オーバーレイ */}
        <div className="app-shell__grain" aria-hidden="true" />

        {/* 保存ステータス（極小・右上） */}
        <SaveStatusBadge />

        {isDebug && (
          <span className="app-shell__debug" aria-label="Debug mode">
            DEBUG
          </span>
        )}

        {/* メインコンテンツ（各ページが自前でヘッダーを描画） */}
        <main className="app-shell__main">{children}</main>

        {/* ボトムナビ（Warm Studio） */}
        <nav className="ws-bnav" aria-label="メインナビゲーション">
          <NavLink
            to={`/${debugSuffix}`}
            end
            className={({ isActive }) =>
              `ws-bnav__item ${isActive ? 'ws-bnav__item--active' : ''}`
            }
          >
            <span className="ws-bnav__icon" aria-hidden="true">📚</span>
            <span className="ws-bnav__label">レッスン</span>
            <span className="ws-bnav__underline" aria-hidden="true" />
          </NavLink>
          <NavLink
            to={`/skill${debugSuffix}`}
            className={({ isActive }) =>
              `ws-bnav__item ${isActive ? 'ws-bnav__item--active' : ''}`
            }
          >
            <span className="ws-bnav__icon" aria-hidden="true">📊</span>
            <span className="ws-bnav__label">スキル</span>
            <span className="ws-bnav__underline" aria-hidden="true" />
          </NavLink>
          <NavLink
            to={`/history${debugSuffix}`}
            className={({ isActive }) =>
              `ws-bnav__item ${isActive ? 'ws-bnav__item--active' : ''}`
            }
          >
            <span className="ws-bnav__icon" aria-hidden="true">📖</span>
            <span className="ws-bnav__label">きろく</span>
            <span className="ws-bnav__underline" aria-hidden="true" />
          </NavLink>
        </nav>
      </div>
    </div>
  )
}
